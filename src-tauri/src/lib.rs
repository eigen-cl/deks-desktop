#![cfg_attr(not(feature = "desktop"), allow(dead_code))]

#[cfg(feature = "desktop")]
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(feature = "desktop")]
use std::sync::Mutex;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};
#[cfg(feature = "desktop")]
use tauri::{Emitter, Manager, State};

const DOCUMENT_FILE: &str = "document.deks.json";
const SKILL_NAMES: [&str; 5] = [
    "deks-cloud-mcp",
    "deks-desktop-mcp",
    "deks-motion-patterns",
    "deks-presentations",
    "design-deks-presentations",
];
const SETTINGS_FILE: &str = "settings.json";
const ASSETS_DIR: &str = "assets";
/// Rust sólo hace la lectura acotada y un sniff preliminar. El WebView aplica
/// el contrato canónico (dimensiones, complejidad y normalización SVG) antes
/// de que los bytes puedan entrar al documento.
const MAX_RASTER_ASSET_BYTES: usize = 50_000_000;
const MAX_SVG_ASSET_BYTES: usize = 5_000_000;
const MAX_AUDIO_ASSET_BYTES: usize = 50_000_000;
const MAX_DEKS_FILE_BYTES: u64 = 95_000_000;
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
struct DeksFileChanged {
    path: String,
    fingerprint: String,
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
    /// Instalaciones que el host se compromete a mantener al día. Cada
    /// actualización de la app vuelve a copiar skills y a reescribir la
    /// configuración MCP de estas entradas, y sólo de estas.
    #[serde(default)]
    managed_installs: Vec<ManagedInstall>,
}

/// Una instalación viva de DEKS dentro de un arnés: dónde quedaron las skills,
/// qué archivo de configuración MCP se escribió y qué carpeta autoriza. Se
/// guarda para poder actualizarla sola, no para reconstruirla adivinando.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedInstall {
    agent_id: String,
    /// `global` para la configuración personal del arnés; `folder` para una
    /// carpeta de trabajo concreta.
    scope: String,
    /// Carpeta elegida cuando `scope` es `folder`.
    folder: Option<String>,
    skills_path: String,
    config_path: String,
    projects_root: String,
    /// Runtime al que apunta la configuración escrita. La app lo muestra para
    /// el cliente que no sabe detectar y que hay que configurar a mano.
    #[serde(default)]
    runtime_path: String,
}

impl ManagedInstall {
    fn same_target(&self, agent_id: &str, scope: &str, folder: Option<&str>) -> bool {
        self.agent_id == agent_id && self.scope == scope && self.folder.as_deref() == folder
    }
}

/// Rust no interpreta el ZIP ni su manifest: Core es el único codec. El host
/// devuelve bytes y una huella de compare-and-swap para no pisar cambios
/// externos entre una lectura y el reemplazo atómico.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeksBytes {
    path: String,
    bytes: Vec<u8>,
    fingerprint: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeksFileEntry {
    path: String,
    root: String,
    updated_at_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedImageBytes {
    id: String,
    media_type: String,
    original_filename: Option<String>,
    bytes: Vec<u8>,
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
    let bytes = fs::read(path.join(DOCUMENT_FILE))
        .map_err(|error| format!("No se pudo leer el documento: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("El documento DEKS no es JSON válido: {error}"))
}

fn atomic_write(path: &Path, document: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Ruta de documento inválida".to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut temporary, document).map_err(|error| error.to_string())?;
    temporary
        .write_all(b"\n")
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn fingerprint(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "deks_path_invalid".to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

fn validate_deks_file_size(size: u64) -> Result<(), String> {
    if size > MAX_DEKS_FILE_BYTES {
        Err("deks_file_too_large".into())
    } else {
        Ok(())
    }
}

fn is_deks_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("deks"))
}

fn canonical_deks_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "deks_file_not_found".to_string())?;
    if !is_deks_file(&canonical) {
        return Err("deks_file_invalid".into());
    }
    Ok(canonical)
}

fn read_deks_bytes(path: &Path) -> Result<DeksBytes, String> {
    let path = canonical_deks_file(path)?;
    let metadata = fs::metadata(&path).map_err(|_| "deks_file_unreadable".to_string())?;
    validate_deks_file_size(metadata.len())?;
    let bytes = fs::read(&path).map_err(|_| "deks_file_unreadable".to_string())?;
    Ok(DeksBytes {
        path: path.to_string_lossy().into_owned(),
        fingerprint: fingerprint(&bytes),
        bytes,
    })
}

fn file_lock_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("deks_path_invalid")?;
    let name = path
        .file_name()
        .ok_or("deks_path_invalid")?
        .to_string_lossy();
    Ok(parent.join(format!(".{name}.lock")))
}

fn file_state_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("deks_path_invalid")?;
    let name = path
        .file_name()
        .ok_or("deks_path_invalid")?
        .to_string_lossy();
    Ok(parent.join(format!(".{name}.state")))
}

fn discard_sidecar_best_effort(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_symlink() {
        let _ = fs::remove_file(path);
    } else {
        let _ = trash::delete(path);
    }
}

fn acquire_file_lock(path: &Path) -> Result<ProjectLock, String> {
    let lock_path = file_lock_path(path)?;
    for _ in 0..100 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "pid={} created_at={:?}",
                    std::process::id(),
                    SystemTime::now()
                );
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
            Err(error) => return Err(format!("deks_file_lock_failed:{error}")),
        }
    }
    Err("lock_timeout".into())
}

fn replace_deks_bytes(
    path: &Path,
    expected_fingerprint: &str,
    bytes: &[u8],
) -> Result<DeksBytes, String> {
    validate_deks_file_size(bytes.len() as u64)?;
    let path = canonical_deks_file(path)?;
    let _lock = acquire_file_lock(&path)?;
    let current = fs::read(&path).map_err(|_| "deks_file_unreadable".to_string())?;
    if fingerprint(&current) != expected_fingerprint {
        return Err("revision_conflict".into());
    }
    atomic_write_bytes(&path, bytes)?;
    read_deks_bytes(&path)
}

fn list_deks_files_in(roots: &[String]) -> Vec<DeksFileEntry> {
    let mut seen = Vec::new();
    let mut files = Vec::new();
    for root in roots {
        let Ok(root) = fs::canonicalize(root) else {
            continue;
        };
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_deks_file(&path) {
                continue;
            }
            let Ok(path) = fs::canonicalize(path) else {
                continue;
            };
            if seen.contains(&path) {
                continue;
            }
            let updated_at_ms = fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|since| since.as_millis() as u64)
                .unwrap_or_default();
            seen.push(path.clone());
            files.push(DeksFileEntry {
                path: path.to_string_lossy().into_owned(),
                root: root.to_string_lossy().into_owned(),
                updated_at_ms,
            });
        }
    }
    files.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
    files
}

fn safe_deks_stem(name: &str) -> Result<String, String> {
    let suffix_start = name.len().saturating_sub(5);
    let without_extension = if name
        .get(suffix_start..)
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".deks"))
    {
        &name[..suffix_start]
    } else {
        name
    };
    let stem = without_extension
        .trim()
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_lowercase();
    if stem.is_empty() {
        Err("deks_filename_invalid".into())
    } else {
        Ok(stem)
    }
}

fn available_deks_file(parent: &Path, stem: &str) -> Result<PathBuf, String> {
    for attempt in 1..1000 {
        let filename = if attempt == 1 {
            format!("{stem}.deks")
        } else {
            format!("{stem}-{attempt}.deks")
        };
        let candidate = parent.join(filename);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("deks_file_unavailable".into())
}

fn write_new_deks_file(parent: &Path, filename: &str, bytes: &[u8]) -> Result<DeksBytes, String> {
    validate_deks_file_size(bytes.len() as u64)?;
    let parent = fs::canonicalize(parent).map_err(|_| "destination_not_found".to_string())?;
    if !parent.is_dir() {
        return Err("destination_not_directory".into());
    }
    let path = available_deks_file(&parent, &safe_deks_stem(filename)?)?;
    let _lock = acquire_file_lock(&path)?;
    atomic_write_bytes(&path, bytes)?;
    read_deks_bytes(&path)
}

fn write_legacy_neighbor(legacy: &Path, bytes: &[u8]) -> Result<DeksBytes, String> {
    validate_deks_file_size(bytes.len() as u64)?;
    let legacy = fs::canonicalize(legacy).map_err(|_| "legacy_folder_not_found".to_string())?;
    if !legacy.is_dir() || !legacy.join(DOCUMENT_FILE).is_file() {
        return Err("legacy_folder_invalid".into());
    }
    let parent = legacy.parent().ok_or("legacy_folder_invalid")?;
    let stem = legacy
        .file_name()
        .ok_or("legacy_folder_invalid")?
        .to_string_lossy();
    let path = available_deks_file(parent, &safe_deks_stem(&stem)?)?;
    let _lock = acquire_file_lock(&path)?;
    atomic_write_bytes(&path, bytes)?;
    read_deks_bytes(&path)
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

/// Deja las skills empaquetadas exactamente como vienen en esta versión de la
/// app, creando la carpeta si hace falta y reemplazando una copia anterior. Es
/// la operación de las carpetas administradas: ahí la copia vieja es de DEKS,
/// no trabajo de nadie, y no actualizarla deja al agente con instrucciones que
/// ya no describen el producto.
fn sync_bundled_skills_from(
    resource: &Path,
    destination: &Path,
) -> Result<Vec<&'static str>, String> {
    fs::create_dir_all(destination).map_err(|_| "destination_not_writable".to_string())?;
    let destination =
        fs::canonicalize(destination).map_err(|_| "destination_not_found".to_string())?;

    let stage = installation_stage(&destination, "skills-sync");
    fs::create_dir(&stage).map_err(|_| "destination_not_writable".to_string())?;
    let result = (|| {
        for skill in SKILL_NAMES {
            copy_tree(&resource.join("skills").join(skill), &stage.join(skill))?;
        }
        let mut installed = Vec::new();
        for skill in SKILL_NAMES {
            let target = destination.join(skill);
            let retired = destination.join(format!(".{skill}.deks-previous"));
            let _ = fs::remove_dir_all(&retired);
            // La copia vigente se aparta antes de poner la nueva: si el
            // reemplazo falla a mitad, la carpeta nunca queda sin skill.
            let had_previous = fs::rename(&target, &retired).is_ok();
            if let Err(error) = fs::rename(stage.join(skill), &target) {
                if had_previous {
                    let _ = fs::rename(&retired, &target);
                }
                return Err(format!("bundle_install_failed:{error}"));
            }
            let _ = fs::remove_dir_all(&retired);
            installed.push(skill);
        }
        Ok(installed)
    })();
    let _ = fs::remove_dir_all(stage);
    result
}

/// Entrada `deks` con la forma que espera cada arnés. Es el mismo contenido que
/// la app muestra como fragmento manual, y por eso vive en un solo lugar.
fn mcp_entry(format: &str, runtime: &Path, projects_root: &Path) -> (String, Value) {
    let script = runtime
        .join("mcp")
        .join("server.mjs")
        .to_string_lossy()
        .into_owned();
    let root = projects_root.to_string_lossy().into_owned();
    let env = serde_json::json!({ "DEKS_PROJECTS_ROOT": root });

    match format {
        "vscode-json" => (
            "servers".into(),
            serde_json::json!({ "type": "stdio", "command": "node", "args": [script], "env": env }),
        ),
        "zed-json" => (
            "context_servers".into(),
            serde_json::json!({ "source": "custom", "command": "node", "args": [script], "env": env }),
        ),
        "opencode-json" => (
            "mcp".into(),
            serde_json::json!({ "type": "local", "command": ["node", script], "enabled": true, "environment": env }),
        ),
        _ => (
            "mcpServers".into(),
            serde_json::json!({ "command": "node", "args": [script], "env": env }),
        ),
    }
}

fn toml_block(runtime: &Path, projects_root: &Path) -> String {
    let script = runtime
        .join("mcp")
        .join("server.mjs")
        .to_string_lossy()
        .into_owned();
    format!(
        "\n[mcp_servers.deks]\ncommand = \"node\"\nargs = [{}]\n\n[mcp_servers.deks.env]\nDEKS_PROJECTS_ROOT = {}\n",
        Value::String(script),
        Value::String(projects_root.to_string_lossy().into_owned()),
    )
}

/// ¿Este archivo ya declara el servidor `deks`? Es lo que decide si el botón de
/// instalar se apaga, así que mira el archivo real y no un recuerdo guardado.
fn mcp_config_installed(format: &str, config_path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(config_path) else {
        return false;
    };
    if format == "codex-toml" {
        return text.contains("[mcp_servers.deks]");
    }
    let (container, _) = mcp_entry(format, Path::new(""), Path::new(""));
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get(&container)
                .and_then(|servers| servers.get("deks"))
                .cloned()
        })
        .is_some()
}

/// Escribe **sólo** la entrada `deks` dentro de la configuración del arnés y
/// conserva intacto todo lo demás: otros servidores MCP, ajustes del editor y
/// claves que DEKS no entiende. Antes del primer cambio guarda una copia del
/// archivo original al lado, para que revertir no dependa de nosotros.
fn write_mcp_config(
    format: &str,
    config_path: &Path,
    runtime: &Path,
    projects_root: &Path,
) -> Result<(), String> {
    let parent = config_path.parent().ok_or("config_path_invalid")?;
    fs::create_dir_all(parent).map_err(|_| "config_not_writable".to_string())?;
    let existing = fs::read_to_string(config_path).ok();
    if let Some(text) = existing.as_ref() {
        let name = config_path
            .file_name()
            .ok_or("config_path_invalid")?
            .to_string_lossy()
            .into_owned();
        let backup = parent.join(format!("{name}.deks-backup"));
        if !backup.exists() {
            let _ = fs::write(&backup, text);
        }
    }

    if format == "codex-toml" {
        let mut text = existing.unwrap_or_default();
        if text.contains("[mcp_servers.deks]") {
            // Reescribir TOML ajeno exigiría un parser completo; si la entrada
            // ya está, se respeta la que la persona tiene.
            return Ok(());
        }
        text.push_str(&toml_block(runtime, projects_root));
        return fs::write(config_path, text).map_err(|_| "config_not_writable".to_string());
    }

    let (container, entry) = mcp_entry(format, runtime, projects_root);
    let mut document = existing
        .as_deref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    let servers = document
        .as_object_mut()
        .ok_or("config_not_writable")?
        .entry(container)
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        return Err("config_shape_unexpected".into());
    }
    servers
        .as_object_mut()
        .ok_or("config_not_writable")?
        .insert("deks".into(), entry);
    atomic_write(config_path, &document)
}

fn install_bundled_mcp_from(resource: &Path, destination: &Path) -> Result<PathBuf, String> {
    let destination =
        fs::canonicalize(destination).map_err(|_| "destination_not_found".to_string())?;
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
    fs::create_dir_all(&root)
        .map_err(|error| format!("No se pudo crear la carpeta DEKS: {error}"))?;
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
    if settings
        .source_folders
        .iter()
        .any(|folder| folder == &canonical)
    {
        return Err("source_folder_already_added".into());
    }
    settings.source_folders.push(canonical.clone());
    Ok(canonical)
}

/// El tipo se decide por los bytes, nunca por la extensión: un `.png` que en
/// realidad es otra cosa entraría al documento con un `mediaType` mentiroso y
/// rompería al abrirlo en otro host.
fn sniff_media_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0 {
        return Some("audio/mpeg");
    }
    let prefix = &bytes[..bytes.len().min(4096)];
    if prefix.windows(4).any(|window| window == b"<svg") {
        return Some("image/svg+xml");
    }
    None
}

/// La extensión se deriva del tipo, así que resolver un asset sólo necesita el
/// descriptor que ya vive en el documento, y la carpeta sigue siendo legible.
fn asset_extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "audio/mpeg" => Some("mp3"),
        "audio/wav" => Some("wav"),
        _ => None,
    }
}

fn asset_file(path: &Path, asset_id: &str, media_type: &str) -> Result<PathBuf, String> {
    if asset_id.is_empty()
        || !asset_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("asset_id_invalid".into());
    }
    let extension =
        asset_extension(media_type).ok_or_else(|| "asset_media_type_unsupported".to_string())?;
    Ok(path
        .join(ASSETS_DIR)
        .join(format!("{asset_id}.{extension}")))
}

fn read_asset_bytes_bounded(path: &Path, max_bytes: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| "asset_unreadable".to_string())?;
    if !metadata.is_file() {
        return Err("asset_unreadable".into());
    }
    if metadata.len() > max_bytes as u64 {
        return Err("asset_too_large".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .map_err(|_| "asset_unreadable".to_string())?
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "asset_unreadable".to_string())?;
    if bytes.len() > max_bytes {
        return Err("asset_too_large".into());
    }
    Ok(bytes)
}

/// Un arnés que el host sabe reconocer. La detección es sólo lectura: mira si
/// existe la carpeta de configuración que el propio programa crea al
/// instalarse. Instalar sí escribe, pero únicamente la entrada `deks` de su
/// configuración MCP y una copia de las skills, ambas bajo petición explícita.
struct AgentTarget {
    id: &'static str,
    /// Familia con la que se agrupa en pantalla: arneses parecidos comparten
    /// formato de configuración y se instalan igual.
    group: &'static str,
    /// Formato de la configuración MCP que entiende ese arnés.
    format: &'static str,
    /// Carpetas que prueban que el arnés está instalado, en orden de
    /// preferencia. La primera que exista define también dónde vive su config.
    homes: &'static [&'static str],
    /// Archivo de configuración MCP personal, relativo a la carpeta detectada.
    config: &'static str,
    /// Carpeta de skills personal, relativa a la carpeta detectada.
    skills: &'static str,
    /// Configuración MCP dentro de una carpeta de trabajo. `None` cuando el
    /// arnés no tiene noción de proyecto y sólo admite instalación global.
    project_config: Option<&'static str>,
    /// Carpeta de skills dentro de una carpeta de trabajo.
    project_skills: Option<&'static str>,
}

const AGENT_TARGETS: [AgentTarget; 12] = [
    AgentTarget {
        id: "claude-code",
        group: "claude",
        format: "mcp-servers-json",
        homes: &[".claude"],
        config: "../.claude.json",
        skills: "skills",
        project_config: Some(".mcp.json"),
        project_skills: Some(".claude/skills"),
    },
    AgentTarget {
        id: "claude-desktop",
        group: "claude",
        format: "mcp-servers-json",
        homes: &[
            "Library/Application Support/Claude",
            "AppData/Roaming/Claude",
            ".config/Claude",
        ],
        config: "claude_desktop_config.json",
        skills: "skills",
        project_config: None,
        project_skills: None,
    },
    AgentTarget {
        id: "codex",
        group: "openai",
        format: "codex-toml",
        homes: &[".codex"],
        config: "config.toml",
        skills: "skills",
        project_config: Some(".codex/config.toml"),
        project_skills: Some(".codex/skills"),
    },
    AgentTarget {
        id: "chatgpt-desktop",
        group: "openai",
        format: "codex-toml",
        homes: &[
            "Library/Application Support/ChatGPT",
            "AppData/Roaming/ChatGPT",
        ],
        config: "../../../.codex/config.toml",
        skills: "../../../.codex/skills",
        project_config: None,
        project_skills: None,
    },
    AgentTarget {
        id: "cursor",
        group: "editors",
        format: "mcp-servers-json",
        homes: &[".cursor"],
        config: "mcp.json",
        skills: "skills",
        project_config: Some(".cursor/mcp.json"),
        project_skills: Some(".cursor/skills"),
    },
    AgentTarget {
        id: "windsurf",
        group: "editors",
        format: "mcp-servers-json",
        homes: &[".codeium/windsurf"],
        config: "mcp_config.json",
        skills: "skills",
        project_config: Some(".windsurf/mcp_config.json"),
        project_skills: Some(".windsurf/skills"),
    },
    AgentTarget {
        id: "antigravity",
        group: "editors",
        format: "mcp-servers-json",
        homes: &[".antigravity", "Library/Application Support/Antigravity"],
        config: "mcp_config.json",
        skills: "skills",
        project_config: Some(".antigravity/mcp_config.json"),
        project_skills: Some(".antigravity/skills"),
    },
    AgentTarget {
        id: "vscode",
        group: "editors",
        format: "vscode-json",
        homes: &[
            "Library/Application Support/Code/User",
            "AppData/Roaming/Code/User",
            ".config/Code/User",
        ],
        config: "mcp.json",
        skills: "skills",
        project_config: Some(".vscode/mcp.json"),
        project_skills: Some(".vscode/skills"),
    },
    AgentTarget {
        id: "zed",
        group: "editors",
        format: "zed-json",
        homes: &[".config/zed"],
        config: "settings.json",
        skills: "skills",
        project_config: Some(".zed/settings.json"),
        project_skills: Some(".zed/skills"),
    },
    AgentTarget {
        id: "continue",
        group: "editors",
        format: "mcp-servers-json",
        homes: &[".continue"],
        config: "config.json",
        skills: "skills",
        project_config: Some(".continue/config.json"),
        project_skills: Some(".continue/skills"),
    },
    AgentTarget {
        id: "opencode",
        group: "cli",
        format: "opencode-json",
        homes: &[".config/opencode"],
        config: "opencode.json",
        skills: "skills",
        project_config: Some("opencode.json"),
        project_skills: Some(".opencode/skills"),
    },
    AgentTarget {
        id: "gemini-cli",
        group: "cli",
        format: "mcp-servers-json",
        homes: &[".gemini"],
        config: "settings.json",
        skills: "skills",
        project_config: Some(".gemini/settings.json"),
        project_skills: Some(".gemini/skills"),
    },
];

fn agent_target(agent_id: &str) -> Result<&'static AgentTarget, String> {
    AGENT_TARGETS
        .iter()
        .find(|candidate| candidate.id == agent_id)
        .ok_or_else(|| "agent_unknown".to_string())
}

/// Un arnés presente en este equipo. Sólo se construye para los detectados: un
/// programa que no está instalado no es una decisión que la persona pueda tomar
/// y sólo llenaría la pantalla.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DetectedAgent {
    id: String,
    group: String,
    format: String,
    home: String,
    config_path: String,
    skills_path: String,
    /// `true` cuando skills y MCP están puestos: es lo que apaga el botón.
    installed: bool,
    skills_installed: bool,
    mcp_installed: bool,
    /// `false` cuando el arnés no tiene carpetas de proyecto y sólo admite la
    /// instalación global.
    supports_folder: bool,
}

/// Normaliza `a/../b` sin tocar el disco: los destinos declarados suben un
/// nivel a propósito y una ruta con `..` a la vista es ilegible en pantalla.
fn normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::ParentDir => {
                result.pop();
            }
            std::path::Component::CurDir => {}
            other => result.push(other.as_os_str()),
        }
    }
    result
}

/// Carpeta real del arnés en este equipo, o `None` si no está instalado.
fn agent_home(target: &AgentTarget, home: &Path) -> Option<PathBuf> {
    target
        .homes
        .iter()
        .map(|relative| home.join(relative))
        .find(|candidate| candidate.is_dir())
}

fn skills_present(destination: &Path) -> bool {
    SKILL_NAMES
        .iter()
        .all(|skill| destination.join(skill).is_dir())
}

fn detect_agents_in(home: &Path) -> Vec<DetectedAgent> {
    AGENT_TARGETS
        .iter()
        .filter_map(|target| {
            let base = agent_home(target, home)?;
            let skills_path = normalize(&base.join(target.skills));
            let config_path = normalize(&base.join(target.config));
            let skills_installed = skills_present(&skills_path);
            let mcp_installed = mcp_config_installed(target.format, &config_path);
            Some(DetectedAgent {
                id: target.id.into(),
                group: target.group.into(),
                format: target.format.into(),
                home: base.to_string_lossy().into_owned(),
                config_path: config_path.to_string_lossy().into_owned(),
                skills_path: skills_path.to_string_lossy().into_owned(),
                installed: skills_installed && mcp_installed,
                skills_installed,
                mcp_installed,
                supports_folder: target.project_config.is_some(),
            })
        })
        .collect()
}

/// Dónde quedan skills y configuración para un arnés y un alcance. Global usa
/// las carpetas personales del programa; `folder` usa las convenciones de
/// proyecto del mismo programa dentro de la carpeta elegida.
fn install_paths(
    target: &AgentTarget,
    home: &Path,
    folder: Option<&Path>,
) -> Result<(PathBuf, PathBuf), String> {
    match folder {
        None => {
            let base = agent_home(target, home).ok_or("agent_not_installed")?;
            Ok((
                normalize(&base.join(target.skills)),
                normalize(&base.join(target.config)),
            ))
        }
        Some(folder) => {
            if !folder.is_dir() {
                return Err("folder_not_found".into());
            }
            let config = target.project_config.ok_or("agent_without_folder_scope")?;
            let skills = target.project_skills.ok_or("agent_without_folder_scope")?;
            Ok((
                normalize(&folder.join(skills)),
                normalize(&folder.join(config)),
            ))
        }
    }
}

/// Instala o actualiza DEKS en un arnés: siempre las skills y siempre la
/// entrada MCP, porque la mitad de la instalación no sirve para nada. Devuelve
/// la entrada que el host se compromete a mantener al día.
fn install_agent_in(
    resource: &Path,
    home: &Path,
    runtime: &Path,
    agent_id: &str,
    folder: Option<&Path>,
    projects_root: &Path,
) -> Result<ManagedInstall, String> {
    let target = agent_target(agent_id)?;
    let (skills_path, config_path) = install_paths(target, home, folder)?;
    sync_bundled_skills_from(resource, &skills_path)?;
    write_mcp_config(target.format, &config_path, runtime, projects_root)?;
    Ok(ManagedInstall {
        agent_id: agent_id.to_string(),
        scope: if folder.is_some() {
            "folder".into()
        } else {
            "global".into()
        },
        folder: folder.map(|path| path.to_string_lossy().into_owned()),
        skills_path: skills_path.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
        projects_root: projects_root.to_string_lossy().into_owned(),
        runtime_path: runtime.to_string_lossy().into_owned(),
    })
}

/// Vuelve a dejar al día todo lo que la persona pidió mantener. Se ejecuta al
/// arrancar: una actualización de la app trae skills nuevas y estas carpetas
/// tienen que recibirlas sin que nadie se acuerde de volver a instalarlas.
fn sync_managed_installs_in(
    resource: &Path,
    runtime: &Path,
    installs: &[ManagedInstall],
) -> Vec<ManagedInstall> {
    installs
        .iter()
        .filter(|install| {
            let Ok(target) = agent_target(&install.agent_id) else {
                return false;
            };
            let skills = Path::new(&install.skills_path);
            let config = Path::new(&install.config_path);
            // Una carpeta que ya no existe dejó de ser una promesa: se cae de la
            // lista en vez de recrear árboles donde alguien borró su trabajo.
            let alive = install
                .folder
                .as_ref()
                .map_or(skills.parent().is_some_and(Path::is_dir), |folder| {
                    Path::new(folder).is_dir()
                });
            if !alive {
                return false;
            }
            let root = PathBuf::from(&install.projects_root);
            sync_bundled_skills_from(resource, skills).is_ok()
                && write_mcp_config(target.format, config, runtime, &root).is_ok()
        })
        .map(|install| ManagedInstall {
            runtime_path: runtime.to_string_lossy().into_owned(),
            ..install.clone()
        })
        .collect()
}

/// El runtime administrado vive en el directorio de datos de la app, no en una
/// carpeta del usuario: así una configuración global puede apuntar a una ruta
/// estable que las actualizaciones del host controlan.
fn install_managed_mcp_in(resource: &Path, data_dir: &Path) -> Result<(PathBuf, bool), String> {
    let target = data_dir.join("deks-local-mcp");
    if target.is_dir() {
        // La ruta se devuelve canonicalizada igual que al instalar: la config
        // que la persona pega tiene que apuntar siempre al mismo lugar.
        let target = fs::canonicalize(&target).unwrap_or(target);
        return Ok((target, false));
    }
    fs::create_dir_all(data_dir).map_err(|_| "destination_not_writable".to_string())?;
    install_bundled_mcp_from(resource, data_dir).map(|path| (path, true))
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn list_deks_files(roots: Vec<String>) -> Vec<DeksFileEntry> {
    list_deks_files_in(&roots)
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn read_deks_file(path: String) -> Result<DeksBytes, String> {
    read_deks_bytes(Path::new(&path))
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn create_deks_file(
    parent_path: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<DeksBytes, String> {
    write_new_deks_file(Path::new(&parent_path), &filename, &bytes)
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn write_deks_file(
    path: String,
    expected_fingerprint: String,
    bytes: Vec<u8>,
) -> Result<DeksBytes, String> {
    replace_deks_bytes(Path::new(&path), &expected_fingerprint, &bytes)
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn migrate_legacy_folder(path: String, bytes: Vec<u8>) -> Result<DeksBytes, String> {
    write_legacy_neighbor(&project_path(&path)?, &bytes)
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn open_project(path: String) -> Result<OpenProject, String> {
    let path = project_path(&path)?;
    let document = read_document(&path)?;
    revision(&document)?;
    Ok(OpenProject {
        path: path.to_string_lossy().into_owned(),
        document,
    })
}

/// Lee una imagen elegida explícitamente por la persona. Los bytes vuelven al
/// frontend para que Core los empaquete en el mismo `.deks`; el host no crea un
/// sidecar ni interpreta el manifest.
#[cfg_attr(feature = "desktop", tauri::command)]
fn read_image_file(source_path: String) -> Result<ImportedImageBytes, String> {
    let bytes = read_asset_bytes_bounded(Path::new(&source_path), MAX_RASTER_ASSET_BYTES)?;
    if bytes.is_empty() {
        return Err("asset_empty".into());
    }
    if bytes.len() > MAX_RASTER_ASSET_BYTES {
        return Err("asset_too_large".into());
    }
    let extension_is_svg = Path::new(&source_path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"));
    let media_type = sniff_media_type(&bytes)
        .or(extension_is_svg.then_some("image/svg+xml"))
        .ok_or_else(|| "asset_media_type_unsupported".to_string())?;
    if !media_type.starts_with("image/") {
        return Err("asset_media_type_unsupported".into());
    }
    if media_type == "image/svg+xml" && bytes.len() > MAX_SVG_ASSET_BYTES {
        return Err("asset_too_large".into());
    }
    let id = format!(
        "asset-{:032x}",
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    );
    Ok(ImportedImageBytes {
        id,
        media_type: media_type.into(),
        original_filename: Path::new(&source_path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned()),
        bytes,
    })
}

/// Devuelve los bytes del asset para que el host arme su propia URL efímera.
/// El documento guarda identidad y tipo, nunca una ruta absoluta.
#[cfg_attr(feature = "desktop", tauri::command)]
fn read_asset(path: String, asset_id: String, media_type: String) -> Result<Vec<u8>, String> {
    let path = project_path(&path)?;
    let file = asset_file(&path, &asset_id, &media_type)?;
    let max_bytes = if media_type.starts_with("audio/") {
        MAX_AUDIO_ASSET_BYTES
    } else if media_type == "image/svg+xml" {
        MAX_SVG_ASSET_BYTES
    } else {
        MAX_RASTER_ASSET_BYTES
    };
    let bytes = read_asset_bytes_bounded(&file, max_bytes).map_err(|error| {
        if error == "asset_unreadable" {
            "asset_not_found".to_string()
        } else {
            error
        }
    })?;
    // A legacy `.svg` path is only preliminary typing: JavaScript parses and
    // canonicalizes it before migration. Raster signatures are unambiguous and
    // can be rejected here without duplicating the deeper contract.
    if media_type != "image/svg+xml" && sniff_media_type(&bytes) != Some(media_type.as_str()) {
        return Err("asset_media_type_mismatch".into());
    }
    Ok(bytes)
}

#[cfg(feature = "desktop")]
fn settings_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|_| "config_dir_unavailable".to_string())
}

/// El inicio necesita raíz y ajustes juntos para su primer render. Pedirlos por
/// separado mostraría la carpeta por defecto sin las fuentes agregadas y el
/// idioma cambiaría un instante después de pintar.
#[cfg(feature = "desktop")]
#[tauri::command]
fn read_workspace(app: tauri::AppHandle) -> Result<Value, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|_| "documents_dir_unavailable".to_string())?;
    let default_root = ensure_default_root(&documents)?;
    let settings = read_settings_from(&settings_directory(&app)?);
    Ok(serde_json::json!({
        "defaultRoot": default_root.to_string_lossy(),
        "locale": settings.locale,
        "sourceFolders": settings.source_folders,
        "managedInstalls": settings.managed_installs,
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

#[cfg_attr(feature = "desktop", tauri::command)]
fn delete_deks_file(path: String) -> Result<(), String> {
    let path = canonical_deks_file(Path::new(&path))?;
    let state_path = file_state_path(&path)?;
    let _lock = acquire_file_lock(&path)?;

    trash::delete(&path).map_err(|error| format!("project_delete_failed:{error}"))?;
    // El archivo es la única unidad autoritativa. Una vez movido a la papelera,
    // los sidecars exactos pueden limpiarse best-effort: un fallo de limpieza
    // no debe decirle a la UI que la presentación sigue existiendo.
    discard_sidecar_best_effort(&state_path);
    Ok(())
}

/// Qué arneses hay en este equipo. Sólo lee, y sólo devuelve los que existen:
/// un programa que no está instalado no es una decisión que nadie pueda tomar.
#[cfg(feature = "desktop")]
#[tauri::command]
fn detect_agents(app: tauri::AppHandle) -> Result<Vec<DetectedAgent>, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "home_dir_unavailable".to_string())?;
    Ok(detect_agents_in(&home))
}

/// Runtime administrado, instalándolo si todavía no estaba. Cualquier
/// instalación en un arnés lo necesita apuntado desde su configuración.
#[cfg(feature = "desktop")]
fn managed_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "resources_unavailable".to_string())?;
    let data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "data_dir_unavailable".to_string())?;
    install_managed_mcp_in(&resources.join("bundled-mcp"), &data).map(|(path, _)| path)
}

/// Instala MCP y skills en un arnés, global o dentro de una carpeta. Nunca una
/// sola de las dos: el agente necesita el servidor para tocar la presentación y
/// las skills para saber cómo hacerlo bien.
#[cfg(feature = "desktop")]
#[tauri::command]
fn install_agent(
    app: tauri::AppHandle,
    agent_id: String,
    folder: Option<String>,
    projects_root: String,
) -> Result<Vec<ManagedInstall>, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "resources_unavailable".to_string())?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "home_dir_unavailable".to_string())?;
    let runtime = managed_runtime(&app)?;
    let folder_path = folder.as_deref().map(PathBuf::from);
    // Una instalación por carpeta autoriza esa misma carpeta: es lo que la
    // persona acaba de elegir y no hay que preguntarle dos veces por lo mismo.
    let root = folder_path
        .clone()
        .unwrap_or_else(|| PathBuf::from(&projects_root));
    let install = install_agent_in(
        &resources.join("bundled-skills"),
        &home,
        &runtime,
        &agent_id,
        folder_path.as_deref(),
        &root,
    )?;

    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    settings.managed_installs.retain(|existing| {
        !existing.same_target(&install.agent_id, &install.scope, install.folder.as_deref())
    });
    settings.managed_installs.push(install);
    write_settings_to(&directory, &settings)?;
    Ok(settings.managed_installs)
}

/// Deja de mantener una carpeta. No borra nada: las skills copiadas y la
/// configuración escrita siguen donde están, sólo dejan de actualizarse solas.
#[cfg(feature = "desktop")]
#[tauri::command]
fn forget_managed_install(
    app: tauri::AppHandle,
    agent_id: String,
    scope: String,
    folder: Option<String>,
) -> Result<Vec<ManagedInstall>, String> {
    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    settings
        .managed_installs
        .retain(|existing| !existing.same_target(&agent_id, &scope, folder.as_deref()));
    write_settings_to(&directory, &settings)?;
    Ok(settings.managed_installs)
}

/// Reinstala skills y configuración en todo lo que la persona pidió mantener.
/// El inicio lo llama una vez: así una app actualizada actualiza también a los
/// agentes que ya la usaban, sin que nadie tenga que acordarse.
#[cfg(feature = "desktop")]
#[tauri::command]
fn sync_managed_installs(app: tauri::AppHandle) -> Result<Vec<ManagedInstall>, String> {
    let directory = settings_directory(&app)?;
    let mut settings = read_settings_from(&directory);
    if settings.managed_installs.is_empty() {
        return Ok(settings.managed_installs);
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|_| "resources_unavailable".to_string())?;
    let runtime = managed_runtime(&app)?;
    let alive = sync_managed_installs_in(
        &resources.join("bundled-skills"),
        &runtime,
        &settings.managed_installs,
    );
    if alive != settings.managed_installs {
        settings.managed_installs = alive;
        write_settings_to(&directory, &settings)?;
    }
    Ok(settings.managed_installs)
}

#[cfg(feature = "desktop")]
#[tauri::command]
fn watch_deks_file(
    app: tauri::AppHandle,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let path = canonical_deks_file(Path::new(&path))?;
    let watched_path = path.clone();
    let parent = path.parent().ok_or("deks_path_invalid")?.to_path_buf();
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !event.paths.iter().any(|candidate| {
            candidate == &watched_path
                || fs::canonicalize(candidate).ok().as_ref() == Some(&watched_path)
        }) {
            return;
        }
        if let Ok(read) = read_deks_bytes(&watched_path) {
            let _ = handle.emit(
                "deks://file-changed",
                DeksFileChanged {
                    path: read.path,
                    fingerprint: read.fingerprint,
                },
            );
        }
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;
    *state.0.lock().map_err(|_| "watch_failed".to_string())? = Some(watcher);
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
            list_deks_files,
            read_deks_file,
            create_deks_file,
            write_deks_file,
            migrate_legacy_folder,
            open_project,
            watch_deks_file,
            read_workspace,
            read_image_file,
            read_asset,
            set_locale,
            add_source_folder,
            remove_source_folder,
            delete_deks_file,
            detect_agents,
            install_agent,
            forget_managed_install,
            sync_managed_installs,
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
    fn file_first_projects_are_listed_as_deks_files() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("uno.deks"), b"PK portable one").unwrap();
        fs::write(root.path().join("dos.DEKS"), b"PK portable two").unwrap();
        fs::write(root.path().join("ignorar.json"), b"{}").unwrap();
        fs::create_dir(root.path().join("legacy-folder")).unwrap();

        let files = list_deks_files_in(&[root.path().to_string_lossy().into_owned()]);

        assert_eq!(files.len(), 2);
        assert!(files.iter().any(|file| file.path.ends_with("uno.deks")));
        assert!(files.iter().any(|file| file.path.ends_with("dos.DEKS")));
        assert!(files
            .iter()
            .all(|file| file.root == fs::canonicalize(root.path()).unwrap().to_string_lossy()));
    }

    #[test]
    fn a_file_write_uses_a_fingerprint_compare_and_swap() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("deck.deks");
        fs::write(&path, b"first archive").unwrap();
        let opened = read_deks_bytes(&path).unwrap();

        let saved = replace_deks_bytes(&path, &opened.fingerprint, b"second archive").unwrap();
        assert_eq!(saved.bytes, b"second archive");

        let conflict =
            replace_deks_bytes(&path, &opened.fingerprint, b"stale archive").unwrap_err();
        assert_eq!(conflict, "revision_conflict");
        assert_eq!(fs::read(path).unwrap(), b"second archive");
    }

    #[test]
    fn deks_size_is_rejected_before_reading_or_writing_bytes() {
        assert!(validate_deks_file_size(MAX_DEKS_FILE_BYTES).is_ok());
        assert_eq!(
            validate_deks_file_size(MAX_DEKS_FILE_BYTES + 1).unwrap_err(),
            "deks_file_too_large"
        );

        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("oversize.deks");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_DEKS_FILE_BYTES + 1).unwrap();
        assert_eq!(read_deks_bytes(&path).unwrap_err(), "deks_file_too_large");
    }

    #[test]
    fn migrating_a_legacy_folder_writes_a_verified_neighbor_and_keeps_the_source() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join("mi-deck");
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join(DOCUMENT_FILE), b"{}").unwrap();

        let migrated = write_legacy_neighbor(&legacy, b"PK portable archive").unwrap();

        assert!(legacy.join(DOCUMENT_FILE).is_file());
        assert!(Path::new(&migrated.path).ends_with("mi-deck.deks"));
        assert_eq!(fs::read(&migrated.path).unwrap(), b"PK portable archive");
    }

    #[test]
    fn syncing_skills_replaces_the_previous_copy_with_complete_directories() {
        let resource = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        for skill in SKILL_NAMES {
            let skill_path = resource
                .path()
                .join("skills")
                .join(skill)
                .join("references");
            fs::create_dir_all(&skill_path).unwrap();
            fs::write(
                resource.path().join("skills").join(skill).join("SKILL.md"),
                skill,
            )
            .unwrap();
            fs::write(skill_path.join("guide.md"), "guide").unwrap();
        }

        let installed =
            sync_bundled_skills_from(resource.path(), &destination.path().join("skills")).unwrap();
        assert_eq!(installed, SKILL_NAMES);
        let skills = destination.path().join("skills");
        assert_eq!(
            fs::read_to_string(skills.join(SKILL_NAMES[0]).join("references/guide.md")).unwrap(),
            "guide"
        );

        // Una versión nueva reemplaza la copia anterior entera: nada de la
        // instalación vieja sobrevive dentro de la carpeta de una skill.
        fs::write(
            resource
                .path()
                .join("skills")
                .join(SKILL_NAMES[0])
                .join("SKILL.md"),
            "v2",
        )
        .unwrap();
        fs::remove_file(
            resource
                .path()
                .join("skills")
                .join(SKILL_NAMES[0])
                .join("references/guide.md"),
        )
        .unwrap();
        sync_bundled_skills_from(resource.path(), &skills).unwrap();
        assert_eq!(
            fs::read_to_string(skills.join(SKILL_NAMES[0]).join("SKILL.md")).unwrap(),
            "v2"
        );
        assert!(!skills
            .join(SKILL_NAMES[0])
            .join("references/guide.md")
            .exists());
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
        assert_eq!(
            installed,
            fs::canonicalize(destination.path())
                .unwrap()
                .join("deks-local-mcp")
        );
        assert!(installed.join("mcp/server.mjs").is_file());
        fs::write(installed.join("package.json"), "personalized").unwrap();
        assert_eq!(
            install_bundled_mcp_from(resource.path(), destination.path()).unwrap_err(),
            "mcp_already_exists"
        );
        assert_eq!(
            fs::read_to_string(installed.join("package.json")).unwrap(),
            "personalized"
        );
    }

    #[test]
    fn two_presentations_with_the_same_name_get_their_own_deks_file() {
        let root = tempfile::tempdir().unwrap();
        let parent = fs::canonicalize(root.path()).unwrap();

        let first = available_deks_file(&parent, "mi-presentacion").unwrap();
        fs::write(&first, b"first archive").unwrap();
        let second = available_deks_file(&parent, "mi-presentacion").unwrap();

        assert_eq!(first.file_name().unwrap(), "mi-presentacion.deks");
        assert_eq!(second.file_name().unwrap(), "mi-presentacion-2.deks");
        assert_ne!(first, second);
    }

    #[test]
    fn a_case_insensitive_deks_suffix_is_not_duplicated() {
        assert_eq!(
            safe_deks_stem("Mi presentación.DEKS").unwrap(),
            "mi-presentación"
        );
        assert_eq!(safe_deks_stem("Roadmap.DeKs").unwrap(), "roadmap");
    }

    #[test]
    fn deleting_a_deks_file_cleans_only_its_exact_sidecars() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("deck.deks");
        let state = root.path().join(".deck.deks.state");
        let lookalike = root.path().join(".deck.deks.state.backup");
        fs::write(&file, b"PK portable archive").unwrap();
        fs::create_dir(&state).unwrap();
        fs::write(state.join("receipt.json"), b"{}").unwrap();
        fs::write(&lookalike, b"keep").unwrap();

        delete_deks_file(file.to_string_lossy().into_owned()).unwrap();

        assert!(!file.exists());
        assert!(!state.exists());
        assert!(!root.path().join(".deck.deks.lock").exists());
        assert!(lookalike.is_file());
    }

    #[cfg(unix)]
    #[test]
    fn deleting_a_deks_file_never_follows_a_state_symlink() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = root.path().join("deck.deks");
        let state = root.path().join(".deck.deks.state");
        fs::write(&file, b"PK portable archive").unwrap();
        fs::write(outside.path().join("keep.json"), b"{}").unwrap();
        symlink(outside.path(), &state).unwrap();

        delete_deks_file(file.to_string_lossy().into_owned()).unwrap();

        assert!(!state.exists());
        assert!(outside.path().join("keep.json").is_file());
    }

    #[test]
    fn deleting_refuses_a_folder_that_is_not_a_presentation() {
        let root = tempfile::tempdir().unwrap();
        let stranger = root.path().join("documentos");
        fs::create_dir(&stranger).unwrap();

        // El borrado pasa por la misma validación que abrir: sin documento
        // canónico, la carpeta no es una presentación y no se toca.
        assert!(project_path(stranger.to_str().unwrap()).is_err());
        assert!(stranger.is_dir());
    }

    fn seed_skill_bundle(resource: &Path) {
        for skill in SKILL_NAMES {
            let skill_path = resource.join("skills").join(skill);
            fs::create_dir_all(&skill_path).unwrap();
            fs::write(skill_path.join("SKILL.md"), skill).unwrap();
        }
    }

    #[test]
    fn only_the_harnesses_present_on_this_machine_reach_the_screen() {
        let home = tempfile::tempdir().unwrap();
        fs::create_dir_all(home.path().join(".claude")).unwrap();

        let agents = detect_agents_in(home.path());
        assert_eq!(agents.len(), 1);
        let claude = &agents[0];
        assert_eq!(claude.id, "claude-code");
        assert!(!claude.installed);
        assert!(claude.supports_folder);
        // La ruta se muestra tal cual se abre: subir un nivel no puede llegar a
        // pantalla como `~/.claude/../.claude.json`.
        assert_eq!(
            claude.config_path,
            home.path().join(".claude.json").to_string_lossy()
        );
        assert_eq!(
            claude.skills_path,
            home.path().join(".claude/skills").to_string_lossy()
        );
    }

    #[test]
    fn installing_a_harness_writes_skills_and_the_mcp_entry_together() {
        let resource = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let runtime = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        seed_skill_bundle(resource.path());

        assert_eq!(
            install_agent_in(
                resource.path(),
                home.path(),
                runtime.path(),
                "claude-code",
                None,
                root.path()
            )
            .unwrap_err(),
            "agent_not_installed",
        );

        fs::create_dir_all(home.path().join(".claude")).unwrap();
        let install = install_agent_in(
            resource.path(),
            home.path(),
            runtime.path(),
            "claude-code",
            None,
            root.path(),
        )
        .unwrap();

        assert_eq!(install.scope, "global");
        assert!(install.folder.is_none());
        assert!(home
            .path()
            .join(".claude/skills")
            .join(SKILL_NAMES[0])
            .join("SKILL.md")
            .is_file());

        let config: Value =
            serde_json::from_slice(&fs::read(home.path().join(".claude.json")).unwrap()).unwrap();
        assert_eq!(config["mcpServers"]["deks"]["command"], "node");
        assert_eq!(
            config["mcpServers"]["deks"]["env"]["DEKS_PROJECTS_ROOT"],
            Value::String(root.path().to_string_lossy().into_owned()),
        );

        // Con las dos mitades puestas, el arnés ya aparece instalado.
        let detected = detect_agents_in(home.path());
        assert!(detected[0].installed);
        assert!(detected[0].skills_installed && detected[0].mcp_installed);
    }

    #[test]
    fn writing_the_mcp_entry_preserves_the_rest_of_a_foreign_configuration() {
        let home = tempfile::tempdir().unwrap();
        let runtime = tempfile::tempdir().unwrap();
        let config = home.path().join("mcp.json");
        fs::write(
            &config,
            r#"{"mcpServers":{"otro":{"command":"python"}},"theme":"dark"}"#,
        )
        .unwrap();

        write_mcp_config("mcp-servers-json", &config, runtime.path(), home.path()).unwrap();

        let written: Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(written["mcpServers"]["otro"]["command"], "python");
        assert_eq!(written["theme"], "dark");
        assert!(written["mcpServers"]["deks"].is_object());
        // El archivo original queda al lado antes del primer cambio.
        assert!(home.path().join("mcp.json.deks-backup").is_file());
        assert!(mcp_config_installed("mcp-servers-json", &config));
    }

    #[test]
    fn a_folder_install_uses_the_project_conventions_and_authorizes_that_folder() {
        let resource = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let runtime = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        seed_skill_bundle(resource.path());
        fs::create_dir_all(home.path().join(".claude")).unwrap();

        let install = install_agent_in(
            resource.path(),
            home.path(),
            runtime.path(),
            "claude-code",
            Some(folder.path()),
            folder.path(),
        )
        .unwrap();

        assert_eq!(install.scope, "folder");
        assert_eq!(
            install.folder.as_deref().unwrap(),
            folder.path().to_string_lossy()
        );
        assert!(folder
            .path()
            .join(".claude/skills")
            .join(SKILL_NAMES[0])
            .join("SKILL.md")
            .is_file());
        let config: Value =
            serde_json::from_slice(&fs::read(folder.path().join(".mcp.json")).unwrap()).unwrap();
        assert_eq!(
            config["mcpServers"]["deks"]["env"]["DEKS_PROJECTS_ROOT"],
            Value::String(folder.path().to_string_lossy().into_owned()),
        );

        // La instalación global no se tocó: son alcances distintos.
        assert!(!home
            .path()
            .join(".claude/skills")
            .join(SKILL_NAMES[0])
            .is_dir());
    }

    #[test]
    fn a_managed_folder_receives_the_skills_of_the_new_version_and_drops_when_it_disappears() {
        let resource = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let runtime = tempfile::tempdir().unwrap();
        let folder = tempfile::tempdir().unwrap();
        seed_skill_bundle(resource.path());
        fs::create_dir_all(home.path().join(".claude")).unwrap();

        let install = install_agent_in(
            resource.path(),
            home.path(),
            runtime.path(),
            "claude-code",
            Some(folder.path()),
            folder.path(),
        )
        .unwrap();
        let skill = folder
            .path()
            .join(".claude/skills")
            .join(SKILL_NAMES[0])
            .join("SKILL.md");
        assert_eq!(fs::read_to_string(&skill).unwrap(), SKILL_NAMES[0]);

        // Una versión nueva de la app trae skills nuevas: la carpeta mantenida
        // las recibe sin que nadie vuelva a instalarlas.
        fs::write(
            resource
                .path()
                .join("skills")
                .join(SKILL_NAMES[0])
                .join("SKILL.md"),
            "v2",
        )
        .unwrap();
        let alive = sync_managed_installs_in(resource.path(), runtime.path(), &[install.clone()]);
        assert_eq!(alive, vec![install.clone()]);
        assert_eq!(fs::read_to_string(&skill).unwrap(), "v2");

        // Una carpeta borrada deja de ser una promesa; no se recrea.
        let gone = folder.path().to_path_buf();
        drop(folder);
        assert!(!gone.is_dir());
        assert!(sync_managed_installs_in(resource.path(), runtime.path(), &[install]).is_empty());
    }

    #[test]
    fn the_managed_runtime_installs_once_and_reuses_its_folder() {
        let resource = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        fs::write(resource.path().join("package.json"), "{}").unwrap();

        let (path, installed) = install_managed_mcp_in(resource.path(), data.path()).unwrap();
        assert!(installed);
        assert!(path.join("package.json").is_file());

        fs::write(path.join("package.json"), "{\"edited\":true}").unwrap();
        let (again, installed) = install_managed_mcp_in(resource.path(), data.path()).unwrap();
        assert!(!installed);
        assert_eq!(again, path);
        assert_eq!(
            fs::read_to_string(path.join("package.json")).unwrap(),
            "{\"edited\":true}"
        );
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
    fn settings_round_trip_and_survive_an_unreadable_file() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            read_settings_from(directory.path()).source_folders,
            Vec::<String>::new()
        );

        let settings = Settings {
            locale: Some("en".into()),
            source_folders: vec!["/tmp/decks".into()],
            managed_installs: Vec::new(),
        };
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
            add_source_folder_to(
                &mut settings,
                &folder.path().join("ausente").to_string_lossy()
            )
            .unwrap_err(),
            "source_folder_not_found",
        );
        assert_eq!(settings.source_folders.len(), 1);
    }

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn an_asset_is_typed_by_its_bytes_and_never_by_its_extension() {
        let source = tempfile::tempdir().unwrap();
        let mut png = PNG.to_vec();
        png.extend_from_slice(b"rest of the image");
        let path = source.path().join("not-really-a-jpeg.jpg");
        fs::write(&path, &png).unwrap();

        let imported = read_image_file(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(imported.media_type, "image/png");
        assert_eq!(
            imported.original_filename.as_deref(),
            Some("not-really-a-jpeg.jpg")
        );
        assert_eq!(imported.bytes, png);

        let vector = source.path().join("vector.svg");
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>"#;
        fs::write(&vector, svg).unwrap();
        let imported = read_image_file(vector.to_string_lossy().into_owned()).unwrap();
        assert_eq!(imported.media_type, "image/svg+xml");
        assert_eq!(imported.bytes, svg);

        let invalid = source.path().join("invalid.png");
        fs::write(&invalid, b"<html>nope</html>").unwrap();
        assert_eq!(
            read_image_file(invalid.to_string_lossy().into_owned()).unwrap_err(),
            "asset_media_type_unsupported"
        );

        let empty = source.path().join("empty.png");
        fs::write(&empty, b"").unwrap();
        assert_eq!(
            read_image_file(empty.to_string_lossy().into_owned()).unwrap_err(),
            "asset_empty"
        );
    }

    #[test]
    fn asset_paths_stay_inside_the_project_and_reject_a_forged_id() {
        let project = tempfile::tempdir().unwrap();
        assert_eq!(
            asset_file(project.path(), "../escape", "image/png").unwrap_err(),
            "asset_id_invalid"
        );
        assert_eq!(
            asset_file(project.path(), "a/b", "image/png").unwrap_err(),
            "asset_id_invalid"
        );
        assert_eq!(
            asset_file(project.path(), "ok-1", "text/html").unwrap_err(),
            "asset_media_type_unsupported"
        );
        assert!(asset_file(project.path(), "ok-1", "image/webp")
            .unwrap()
            .ends_with("assets/ok-1.webp"));
        assert!(asset_file(project.path(), "voice-1", "audio/wav")
            .unwrap()
            .ends_with("assets/voice-1.wav"));
    }

    #[test]
    fn an_oversized_asset_is_refused_before_touching_the_disk() {
        let source = tempfile::tempdir().unwrap();
        let mut huge = PNG.to_vec();
        huge.resize(MAX_RASTER_ASSET_BYTES + 1, 0);
        let path = source.path().join("huge.png");
        fs::write(&path, huge).unwrap();

        assert_eq!(
            read_image_file(path.to_string_lossy().into_owned()).unwrap_err(),
            "asset_too_large"
        );
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

        assert_eq!(
            install_bundled_mcp_from(resource.path(), destination.path()).unwrap_err(),
            "bundle_source_symlink"
        );
        assert!(!destination.path().join("deks-local-mcp").exists());
    }
}
