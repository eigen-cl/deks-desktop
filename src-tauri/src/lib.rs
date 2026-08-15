#![cfg_attr(not(feature = "desktop"), allow(dead_code))]

#[cfg(feature = "desktop")]
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};
#[cfg(feature = "desktop")]
use std::sync::Mutex;
#[cfg(feature = "desktop")]
use tauri::{Emitter, State};

const DOCUMENT_FILE: &str = "document.deks.json";
const LOCK_FILE: &str = "project.lock";

#[cfg(feature = "desktop")]
struct WatchState(Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenProject {
    path: String,
    document: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectChanged {
    path: String,
    revision: u64,
    origin: String,
    changed_slide_ids: Vec<String>,
    changed_element_ids: Vec<String>,
}

struct ProjectLock(PathBuf);

impl Drop for ProjectLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn revision(document: &Value) -> Result<u64, String> {
    document
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "El documento no tiene una revisión válida".into())
}

fn project_path(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "La carpeta no existe".to_string())?;
    if !canonical.is_dir() || !canonical.join(DOCUMENT_FILE).is_file() {
        return Err("La carpeta no contiene document.deks.json".into());
    }
    Ok(canonical)
}

fn read_document(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path.join(DOCUMENT_FILE)).map_err(|error| format!("No se pudo leer el documento: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("El documento DEKS no es JSON válido: {error}"))
}

fn acquire_lock(path: &Path) -> Result<ProjectLock, String> {
    let lock_path = path.join(LOCK_FILE);
    for _ in 0..100 {
        match OpenOptions::new().write(true).create_new(true).open(&lock_path) {
            Ok(mut file) => {
                let _ = writeln!(file, "pid={} created_at={:?}", std::process::id(), SystemTime::now());
                return Ok(ProjectLock(lock_path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(&lock_path)
                    .and_then(|metadata| metadata.modified())
                    .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
                    .map(|age| age > Duration::from_secs(30))
                    .unwrap_or(false);
                if stale {
                    let _ = fs::remove_file(&lock_path);
                } else {
                    thread::sleep(Duration::from_millis(20));
                }
            }
            Err(error) => return Err(format!("No se pudo bloquear la presentación: {error}")),
        }
    }
    Err("La presentación está siendo editada por otro proceso".into())
}

fn atomic_write(path: &Path, document: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Ruta de documento inválida".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut temporary, document).map_err(|error| error.to_string())?;
    temporary.write_all(b"\n").map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.error.to_string())?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn write_receipt(path: &Path, change: &ProjectChanged) -> Result<(), String> {
    let changes = path.join("changes");
    fs::create_dir_all(&changes).map_err(|error| error.to_string())?;
    let receipt = serde_json::to_value(change).map_err(|error| error.to_string())?;
    atomic_write(&changes.join(format!("{}.json", change.revision)), &receipt)
}

fn latest_change(path: &Path, fallback_revision: u64) -> ProjectChanged {
    let receipt = path.join("changes").join(format!("{fallback_revision}.json"));
    fs::read(&receipt)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ProjectChangedWire>(&bytes).ok())
        .map(|value| ProjectChanged {
            path: path.to_string_lossy().into_owned(),
            revision: value.revision,
            origin: value.origin,
            changed_slide_ids: value.changed_slide_ids,
            changed_element_ids: value.changed_element_ids,
        })
        .unwrap_or(ProjectChanged {
            path: path.to_string_lossy().into_owned(),
            revision: fallback_revision,
            origin: "external".into(),
            changed_slide_ids: vec![],
            changed_element_ids: vec![],
        })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectChangedWire {
    revision: u64,
    origin: String,
    #[serde(default)]
    changed_slide_ids: Vec<String>,
    #[serde(default)]
    changed_element_ids: Vec<String>,
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn create_project(parent_path: String, name: String, document: Value) -> Result<OpenProject, String> {
    let parent = fs::canonicalize(parent_path).map_err(|_| "La carpeta de destino no existe".to_string())?;
    if !parent.is_dir() {
        return Err("El destino no es una carpeta".into());
    }
    let slug: String = name
        .trim()
        .chars()
        .map(|character| if character.is_alphanumeric() { character } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_lowercase();
    if slug.is_empty() {
        return Err("El nombre debe contener letras o números".into());
    }
    let path = parent.join(slug);
    fs::create_dir(&path).map_err(|error| format!("No se pudo crear la carpeta: {error}"))?;
    fs::create_dir(path.join("assets")).map_err(|error| error.to_string())?;
    fs::create_dir(path.join("changes")).map_err(|error| error.to_string())?;
    atomic_write(&path.join(DOCUMENT_FILE), &document)?;
    Ok(OpenProject { path: path.to_string_lossy().into_owned(), document })
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn open_project(path: String) -> Result<OpenProject, String> {
    let path = project_path(&path)?;
    let document = read_document(&path)?;
    revision(&document)?;
    Ok(OpenProject { path: path.to_string_lossy().into_owned(), document })
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn save_project(
    path: String,
    expected_revision: u64,
    document: Value,
    changed_slide_ids: Vec<String>,
    changed_element_ids: Vec<String>,
) -> Result<OpenProject, String> {
    let path = project_path(&path)?;
    let _lock = acquire_lock(&path)?;
    let current = read_document(&path)?;
    if revision(&current)? != expected_revision {
        return Err("revision_conflict".into());
    }
    let next_revision = revision(&document)?;
    if next_revision != expected_revision + 1 {
        return Err("La próxima revisión debe ser exactamente la revisión esperada + 1".into());
    }
    atomic_write(&path.join(DOCUMENT_FILE), &document)?;
    write_receipt(
        &path,
        &ProjectChanged {
            path: path.to_string_lossy().into_owned(),
            revision: next_revision,
            origin: "user".into(),
            changed_slide_ids,
            changed_element_ids,
        },
    )?;
    Ok(OpenProject { path: path.to_string_lossy().into_owned(), document })
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn watch_project(app: tauri::AppHandle, state: State<'_, WatchState>, path: String) -> Result<(), String> {
    let path = project_path(&path)?;
    let watched_path = path.clone();
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !event.paths.iter().any(|candidate| candidate.ends_with(DOCUMENT_FILE)) {
            return;
        }
        if let Ok(document) = read_document(&watched_path) {
            if let Ok(current_revision) = revision(&document) {
                let _ = handle.emit("deks://presentation-changed", latest_change(&watched_path, current_revision));
            }
        }
    }).map_err(|error| error.to_string())?;
    // Watch the containing directory: atomic saves replace the document inode,
    // so watching the file itself would silently stop after the first change.
    watcher.watch(&path, RecursiveMode::NonRecursive).map_err(|error| error.to_string())?;
    *state.0.lock().map_err(|_| "No se pudo activar el watcher".to_string())? = Some(watcher);
    Ok(())
}

#[cfg(feature = "desktop")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![create_project, open_project, save_project, watch_project])
        .run(tauri::generate_context!())
        .expect("error while running DEKS Desktop");
}

#[cfg(not(feature = "desktop"))]
pub fn run() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_requires_a_non_negative_integer() {
        assert_eq!(revision(&serde_json::json!({"revision": 3})).unwrap(), 3);
        assert!(revision(&serde_json::json!({"revision": -1})).is_err());
    }

    #[test]
    fn atomic_write_replaces_a_complete_json_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(DOCUMENT_FILE);
        atomic_write(&path, &serde_json::json!({"revision": 8})).unwrap();
        let read: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(read["revision"], 8);
    }

    #[test]
    fn save_uses_compare_and_swap_and_writes_an_observable_receipt() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("changes")).unwrap();
        atomic_write(
            &directory.path().join(DOCUMENT_FILE),
            &serde_json::json!({"id": "deck-1", "revision": 0}),
        ).unwrap();
        let path = directory.path().to_string_lossy().into_owned();

        let saved = save_project(
            path.clone(),
            0,
            serde_json::json!({"id": "deck-1", "revision": 1}),
            vec!["slide-1".into()],
            vec!["element-1".into()],
        ).unwrap();
        assert_eq!(revision(&saved.document).unwrap(), 1);
        let receipt: Value = serde_json::from_slice(
            &fs::read(directory.path().join("changes/1.json")).unwrap(),
        ).unwrap();
        assert_eq!(receipt["origin"], "user");
        assert_eq!(receipt["changedSlideIds"][0], "slide-1");

        let conflict = save_project(
            path,
            0,
            serde_json::json!({"id": "deck-1", "revision": 1}),
            vec![],
            vec![],
        ).unwrap_err();
        assert_eq!(conflict, "revision_conflict");
        assert_eq!(revision(&read_document(directory.path()).unwrap()).unwrap(), 1);
    }
}
