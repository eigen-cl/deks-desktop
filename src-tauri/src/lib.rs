#![cfg_attr(not(feature = "desktop"), allow(dead_code))]

#[cfg(feature = "desktop")]
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
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
use tauri::{Emitter, Manager, State};

const DOCUMENT_FILE: &str = "document.deks.json";
const LOCK_FILE: &str = "project.lock";
const SKILL_NAMES: [&str; 2] = ["deks-presentations", "design-deks-presentations"];
const SETTINGS_FILE: &str = "settings.json";
/// Carpeta por defecto dentro de Documentos. La app la crea sola: pedirle una
/// ubicación a quien recién abre DEKS es pedirle una decisión antes de tener
/// con qué decidir.
const DEFAULT_ROOT_NAME: &str = "Deks";

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

/// Preferencias del host, no del documento. Viven en el directorio de
/// configuración de la app y nunca dentro de una carpeta de presentación: una
/// carpeta DEKS debe poder copiarse a otro equipo sin arrastrar ajustes ajenos.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    locale: Option<String>,
    #[serde(default)]
    source_folders: Vec<String>,
}

/// Lo justo para dibujar una tarjeta en el inicio. Deliberadamente no incluye
/// los elementos: listar veinte presentaciones no debe cargar veinte documentos
/// completos en memoria para pintar miniaturas de 180 px.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    path: String,
    root: String,
    name: String,
    revision: u64,
    slide_count: usize,
    updated_at_ms: u64,
    canvas: Value,
    background: Value,
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

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|_| "bundle_source_missing".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("bundle_source_symlink".into());
    }
    if metadata.is_file() {
        fs::copy(source, destination).map_err(|_| "bundle_copy_failed".to_string())?;
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err("bundle_source_invalid".into());
    }
    fs::create_dir(destination).map_err(|_| "bundle_copy_failed".to_string())?;
    for entry in fs::read_dir(source).map_err(|_| "bundle_copy_failed".to_string())? {
        let entry = entry.map_err(|_| "bundle_copy_failed".to_string())?;
        copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn installation_stage(destination: &Path, kind: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    destination.join(format!(".deks-{kind}-{}-{nonce}", std::process::id()))
}

fn install_bundled_skills_from(resource: &Path, destination: &Path) -> Result<Vec<&'static str>, String> {
    let destination = fs::canonicalize(destination).map_err(|_| "destination_not_found".to_string())?;
    if !destination.is_dir() {
        return Err("destination_not_directory".into());
    }
    for skill in SKILL_NAMES {
        if destination.join(skill).exists() {
            return Err("skill_already_exists".into());
        }
    }

    let stage = installation_stage(&destination, "skills-install");
    fs::create_dir(&stage).map_err(|_| "destination_not_writable".to_string())?;
    let result = (|| {
        for skill in SKILL_NAMES {
            copy_tree(&resource.join("skills").join(skill), &stage.join(skill))?;
        }
        let mut installed = Vec::new();
        for skill in SKILL_NAMES {
            let target = destination.join(skill);
            if let Err(error) = fs::rename(stage.join(skill), &target) {
                for prior in installed {
                    let _ = fs::remove_dir_all(destination.join(prior));
                }
                return Err(format!("bundle_install_failed:{error}"));
            }
            installed.push(skill);
        }
        Ok(installed)
    })();
    let _ = fs::remove_dir_all(stage);
    result
}

fn install_bundled_mcp_from(resource: &Path, destination: &Path) -> Result<PathBuf, String> {
    let destination = fs::canonicalize(destination).map_err(|_| "destination_not_found".to_string())?;
    if !destination.is_dir() {
        return Err("destination_not_directory".into());
    }
    let target = destination.join("deks-local-mcp");
    if target.exists() {
        return Err("mcp_already_exists".into());
    }
    let stage = installation_stage(&destination, "mcp-install");
    let result = (|| {
        copy_tree(resource, &stage)?;
        fs::rename(&stage, &target).map_err(|_| "bundle_install_failed".to_string())?;
        Ok(target)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}

fn ensure_default_root(documents: &Path) -> Result<PathBuf, String> {
    let root = documents.join(DEFAULT_ROOT_NAME);
    fs::create_dir_all(&root).map_err(|error| format!("No se pudo crear la carpeta DEKS: {error}"))?;
    fs::canonicalize(&root).map_err(|error| error.to_string())
}

/// Unos ajustes ilegibles no son motivo para bloquear la app: se vuelve a los
/// valores por defecto y la próxima escritura los deja sanos otra vez.
fn read_settings_from(directory: &Path) -> Settings {
    fs::read(directory.join(SETTINGS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_settings_to(directory: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    atomic_write(&directory.join(SETTINGS_FILE), &value)
}

/// Acepta una carpeta fuente sólo si existe y todavía no está en la lista. Las
/// rutas se guardan canonicalizadas para que el mismo directorio alcanzado por
/// dos caminos distintos no aparezca dos veces en el inicio.
fn add_source_folder_to(settings: &mut Settings, path: &str) -> Result<String, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "source_folder_not_found".to_string())?;
    if !canonical.is_dir() {
        return Err("source_folder_not_directory".into());
    }
    let canonical = canonical.to_string_lossy().into_owned();
    if settings.source_folders.iter().any(|folder| folder == &canonical) {
        return Err("source_folder_already_added".into());
    }
    settings.source_folders.push(canonical.clone());
    Ok(canonical)
}

fn summarize_project(path: &Path, root: &Path) -> Option<ProjectSummary> {
    let document = read_document(path).ok()?;
    let slides = document.get("slides").and_then(Value::as_array);
    let updated_at_ms = fs::metadata(path.join(DOCUMENT_FILE))
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|since| since.as_millis() as u64)
        .unwrap_or_default();
    Some(ProjectSummary {
        path: path.to_string_lossy().into_owned(),
        root: root.to_string_lossy().into_owned(),
        // El nombre del documento manda; la carpeta es sólo el respaldo para una
        // presentación escrita a mano sin `name`.
        name: document
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|name| !name.trim().is_empty())
            .or_else(|| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "—".into()),
        revision: revision(&document).unwrap_or_default(),
        slide_count: slides.map(Vec::len).unwrap_or_default(),
        updated_at_ms,
        canvas: document.get("canvas").cloned().unwrap_or(Value::Null),
        background: slides
            .and_then(|slides| slides.first())
            .and_then(|slide| slide.get("background"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

/// Recorre un solo nivel por raíz. Una carpeta DEKS es una carpeta con
/// `document.deks.json` dentro, así que descender más sólo encontraría `assets`
/// y `changes` de las que ya se listaron.
fn list_projects_in(roots: &[String]) -> Vec<ProjectSummary> {
    let mut seen = Vec::new();
    let mut projects = Vec::new();
    for root in roots {
        let Ok(root) = fs::canonicalize(root) else { continue };
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.join(DOCUMENT_FILE).is_file() {
                continue;
            }
            let Ok(path) = fs::canonicalize(&path) else { continue };
            if seen.contains(&path) {
                continue;
            }
            if let Some(summary) = summarize_project(&path, &root) {
                seen.push(path);
                projects.push(summary);
            }
        }
    }
    // Lo último que se tocó es lo que se quiere volver a abrir.
    projects.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
    projects
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

#[cfg_attr(feature = "desktop", tauri::command)]
fn list_projects(roots: Vec<String>) -> Vec<ProjectSummary> {
    list_projects_in(&roots)
}

#[cfg(feature = "desktop")]
fn settings_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|_| "config_dir_unavailable".to_string())
}

/// El inicio necesita raíz y ajustes juntos para su primer render. Pedirlos por
/// separado mostraría la carpeta por defecto sin las fuentes agregadas y el
/// idioma cambiaría un instante después de pintar.
#[cfg(feature = "desktop")]
#[tauri::command]
fn read_workspace(app: tauri::AppHandle) -> Result<Value, String> {
    let documents = app.path().document_dir().map_err(|_| "documents_dir_unavailable".to_string())?;
    let default_root = ensure_default_root(&documents)?;
    let settings = read_settings_from(&settings_directory(&app)?);
    Ok(serde_json::json!({
        "defaultRoot": default_root.to_string_lossy(),
        "locale": settings.locale,
        "sourceFolders": settings.source_folders,
    }))
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn set_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    settings.locale = Some(locale);
    write_settings_to(&directory, &settings)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn add_source_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    add_source_folder_to(&mut settings, &path)?;
    write_settings_to(&directory, &settings)?;
    Ok(settings.source_folders)
}

/// Quitar una fuente la saca de la vista, nunca del disco: las presentaciones
/// siguen donde estaban y volver a agregarla las recupera enteras.
#[cfg(feature = "desktop")]
#[tauri::command]
fn remove_source_folder(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    settings.source_folders.retain(|folder| folder != &path);
    write_settings_to(&directory, &settings)?;
    Ok(settings.source_folders)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn install_bundled_skills(app: tauri::AppHandle, destination_path: String) -> Result<Vec<String>, String> {
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable".to_string())?;
    install_bundled_skills_from(&resources.join("bundled-skills"), Path::new(&destination_path))
        .map(|skills| skills.into_iter().map(str::to_string).collect())
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn install_bundled_mcp(app: tauri::AppHandle, destination_path: String) -> Result<String, String> {
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable".to_string())?;
    install_bundled_mcp_from(&resources.join("bundled-mcp"), Path::new(&destination_path))
        .map(|path| path.to_string_lossy().into_owned())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project,
            watch_project,
            read_workspace,
            list_projects,
            set_locale,
            add_source_folder,
            remove_source_folder,
            install_bundled_skills,
            install_bundled_mcp,
        ])
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

    #[test]
    fn bundled_skills_install_as_complete_directories_without_overwriting() {
        let resource = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        for skill in SKILL_NAMES {
            let skill_path = resource.path().join("skills").join(skill).join("references");
            fs::create_dir_all(&skill_path).unwrap();
            fs::write(resource.path().join("skills").join(skill).join("SKILL.md"), skill).unwrap();
            fs::write(skill_path.join("guide.md"), "guide").unwrap();
        }

        let installed = install_bundled_skills_from(resource.path(), destination.path()).unwrap();
        assert_eq!(installed, SKILL_NAMES);
        assert_eq!(fs::read_to_string(destination.path().join(SKILL_NAMES[0]).join("references/guide.md")).unwrap(), "guide");

        let existing = destination.path().join(SKILL_NAMES[0]).join("SKILL.md");
        fs::write(&existing, "personalized").unwrap();
        assert_eq!(install_bundled_skills_from(resource.path(), destination.path()).unwrap_err(), "skill_already_exists");
        assert_eq!(fs::read_to_string(existing).unwrap(), "personalized");
    }

    #[test]
    fn bundled_mcp_installs_without_a_source_checkout_and_never_overwrites() {
        let resource = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        fs::create_dir(resource.path().join("mcp")).unwrap();
        fs::write(resource.path().join("package.json"), "{}").unwrap();
        fs::write(resource.path().join("mcp/server.mjs"), "// server").unwrap();

        let installed = install_bundled_mcp_from(resource.path(), destination.path()).unwrap();
        // La instalación canonicaliza su destino, y en macOS `/var` es un enlace
        // a `/private/var`: comparar contra la ruta cruda del tempdir fallaba
        // sólo fuera de Linux.
        assert_eq!(installed, fs::canonicalize(destination.path()).unwrap().join("deks-local-mcp"));
        assert!(installed.join("mcp/server.mjs").is_file());
        fs::write(installed.join("package.json"), "personalized").unwrap();
        assert_eq!(install_bundled_mcp_from(resource.path(), destination.path()).unwrap_err(), "mcp_already_exists");
        assert_eq!(fs::read_to_string(installed.join("package.json")).unwrap(), "personalized");
    }

    fn seed_project(root: &Path, folder: &str, document: Value) -> PathBuf {
        let path = root.join(folder);
        fs::create_dir_all(&path).unwrap();
        atomic_write(&path.join(DOCUMENT_FILE), &document).unwrap();
        path
    }

    #[test]
    fn default_root_is_created_once_inside_documents() {
        let documents = tempfile::tempdir().unwrap();
        let root = ensure_default_root(documents.path()).unwrap();
        assert!(root.is_dir());
        assert_eq!(root.file_name().unwrap(), DEFAULT_ROOT_NAME);
        // Abrir la app dos veces no puede fallar por una carpeta que ya existe.
        assert_eq!(ensure_default_root(documents.path()).unwrap(), root);
    }

    #[test]
    fn listing_summarizes_each_project_without_reading_elements() {
        let root = tempfile::tempdir().unwrap();
        seed_project(root.path(), "alpha", serde_json::json!({
            "name": "Gobernar la IA",
            "revision": 81,
            "canvas": {"width": 1600, "height": 900},
            "slides": [{"background": {"kind": "solid", "color": "#0B1020"}}, {}],
        }));
        // Una carpeta cualquiera no es una presentación.
        fs::create_dir_all(root.path().join("no-es-deks")).unwrap();

        let projects = list_projects_in(&[root.path().to_string_lossy().into_owned()]);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Gobernar la IA");
        assert_eq!(projects[0].revision, 81);
        assert_eq!(projects[0].slide_count, 2);
        assert_eq!(projects[0].background["color"], "#0B1020");
        assert!(projects[0].updated_at_ms > 0);
    }

    #[test]
    fn listing_falls_back_to_the_folder_name_and_never_repeats_a_project() {
        let root = tempfile::tempdir().unwrap();
        seed_project(root.path(), "sin-nombre", serde_json::json!({"revision": 0, "slides": []}));
        let path = root.path().to_string_lossy().into_owned();

        // La misma raíz declarada dos veces —por defecto y como fuente— sigue
        // mostrando una sola tarjeta.
        let projects = list_projects_in(&[path.clone(), path]);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "sin-nombre");
        assert_eq!(projects[0].slide_count, 0);
    }

    #[test]
    fn settings_round_trip_and_survive_an_unreadable_file() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(read_settings_from(directory.path()).source_folders, Vec::<String>::new());

        let settings = Settings { locale: Some("en".into()), source_folders: vec!["/tmp/decks".into()] };
        write_settings_to(directory.path(), &settings).unwrap();
        let read = read_settings_from(directory.path());
        assert_eq!(read.locale.as_deref(), Some("en"));
        assert_eq!(read.source_folders, vec!["/tmp/decks".to_string()]);

        fs::write(directory.path().join(SETTINGS_FILE), "{ no es json").unwrap();
        assert_eq!(read_settings_from(directory.path()).locale, None);
    }

    #[test]
    fn a_source_folder_must_exist_and_is_never_added_twice() {
        let folder = tempfile::tempdir().unwrap();
        let mut settings = Settings::default();

        let added = add_source_folder_to(&mut settings, &folder.path().to_string_lossy()).unwrap();
        assert_eq!(settings.source_folders, vec![added.clone()]);
        assert_eq!(
            add_source_folder_to(&mut settings, &folder.path().to_string_lossy()).unwrap_err(),
            "source_folder_already_added",
        );
        assert_eq!(
            add_source_folder_to(&mut settings, &folder.path().join("ausente").to_string_lossy()).unwrap_err(),
            "source_folder_not_found",
        );
        assert_eq!(settings.source_folders.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn bundled_installation_rejects_symlinks_in_packaged_content() {
        use std::os::unix::fs::symlink;

        let resource = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        fs::create_dir(resource.path().join("mcp")).unwrap();
        fs::write(resource.path().join("package.json"), "{}").unwrap();
        symlink(outside.path(), resource.path().join("mcp/linked-secret")).unwrap();

        assert_eq!(install_bundled_mcp_from(resource.path(), destination.path()).unwrap_err(), "bundle_source_symlink");
        assert!(!destination.path().join("deks-local-mcp").exists());
    }
}
