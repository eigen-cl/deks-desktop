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
const SKILL_NAMES: [&str; 5] = [
    "deks-cloud-mcp",
    "deks-desktop-mcp",
    "deks-motion-patterns",
    "deks-presentations",
    "design-deks-presentations",
];
const SETTINGS_FILE: &str = "settings.json";
const ASSETS_DIR: &str = "assets";
/// Techo por asset. Un documento local no debería arrastrar un archivo que la
/// web luego no pueda abrir ni el `.deks` empaquetar con comodidad.
const MAX_ASSET_BYTES: usize = 16 * 1024 * 1024;
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

/// Deja las skills empaquetadas exactamente como vienen en esta versión de la
/// app, creando la carpeta si hace falta y reemplazando una copia anterior. Es
/// la operación de las carpetas administradas: ahí la copia vieja es de DEKS,
/// no trabajo de nadie, y no actualizarla deja al agente con instrucciones que
/// ya no describen el producto.
fn sync_bundled_skills_from(resource: &Path, destination: &Path) -> Result<Vec<&'static str>, String> {
    fs::create_dir_all(destination).map_err(|_| "destination_not_writable".to_string())?;
    let destination = fs::canonicalize(destination).map_err(|_| "destination_not_found".to_string())?;

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
    let script = runtime.join("mcp").join("server.mjs").to_string_lossy().into_owned();
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
    let script = runtime.join("mcp").join("server.mjs").to_string_lossy().into_owned();
    format!(
        "\n[mcp_servers.deks]\ncommand = \"node\"\nargs = [{}]\n\n[mcp_servers.deks.env]\nDEKS_PROJECTS_ROOT = {}\n",
        Value::String(script),
        Value::String(projects_root.to_string_lossy().into_owned()),
    )
}

/// ¿Este archivo ya declara el servidor `deks`? Es lo que decide si el botón de
/// instalar se apaga, así que mira el archivo real y no un recuerdo guardado.
fn mcp_config_installed(format: &str, config_path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(config_path) else { return false };
    if format == "codex-toml" {
        return text.contains("[mcp_servers.deks]");
    }
    let (container, _) = mcp_entry(format, Path::new(""), Path::new(""));
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get(&container).and_then(|servers| servers.get("deks")).cloned())
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
        let name = config_path.file_name().ok_or("config_path_invalid")?.to_string_lossy().into_owned();
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
    servers.as_object_mut().ok_or("config_not_writable")?.insert("deks".into(), entry);
    atomic_write(config_path, &document)
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
        _ => None,
    }
}

fn asset_file(path: &Path, asset_id: &str, media_type: &str) -> Result<PathBuf, String> {
    if asset_id.is_empty() || !asset_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("asset_id_invalid".into());
    }
    let extension = asset_extension(media_type).ok_or_else(|| "asset_media_type_unsupported".to_string())?;
    Ok(path.join(ASSETS_DIR).join(format!("{asset_id}.{extension}")))
}

fn store_asset_bytes(path: &Path, bytes: &[u8]) -> Result<Value, String> {
    if bytes.is_empty() {
        return Err("asset_empty".into());
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("asset_too_large".into());
    }
    let media_type = sniff_media_type(bytes).ok_or_else(|| "asset_media_type_unsupported".to_string())?;
    let asset_id = format!(
        "asset-{:032x}",
        SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_nanos(),
    );
    let destination = asset_file(path, &asset_id, media_type)?;
    fs::create_dir_all(path.join(ASSETS_DIR)).map_err(|error| error.to_string())?;
    // Escritura atómica igual que el documento: un asset a medio copiar dejaría
    // un descriptor apuntando a bytes truncados.
    let mut temporary = tempfile::NamedTempFile::new_in(path.join(ASSETS_DIR)).map_err(|error| error.to_string())?;
    temporary.write_all(bytes).map_err(|error| error.to_string())?;
    temporary.as_file().sync_all().map_err(|error| error.to_string())?;
    temporary.persist(&destination).map_err(|error| error.error.to_string())?;
    Ok(serde_json::json!({ "id": asset_id, "mediaType": media_type }))
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
    AgentTarget { id: "claude-code", group: "claude", format: "mcp-servers-json", homes: &[".claude"], config: "../.claude.json", skills: "skills", project_config: Some(".mcp.json"), project_skills: Some(".claude/skills") },
    AgentTarget { id: "claude-desktop", group: "claude", format: "mcp-servers-json", homes: &["Library/Application Support/Claude", "AppData/Roaming/Claude", ".config/Claude"], config: "claude_desktop_config.json", skills: "skills", project_config: None, project_skills: None },
    AgentTarget { id: "codex", group: "openai", format: "codex-toml", homes: &[".codex"], config: "config.toml", skills: "skills", project_config: Some(".codex/config.toml"), project_skills: Some(".codex/skills") },
    AgentTarget { id: "chatgpt-desktop", group: "openai", format: "codex-toml", homes: &["Library/Application Support/ChatGPT", "AppData/Roaming/ChatGPT"], config: "../../../.codex/config.toml", skills: "../../../.codex/skills", project_config: None, project_skills: None },
    AgentTarget { id: "cursor", group: "editors", format: "mcp-servers-json", homes: &[".cursor"], config: "mcp.json", skills: "skills", project_config: Some(".cursor/mcp.json"), project_skills: Some(".cursor/skills") },
    AgentTarget { id: "windsurf", group: "editors", format: "mcp-servers-json", homes: &[".codeium/windsurf"], config: "mcp_config.json", skills: "skills", project_config: Some(".windsurf/mcp_config.json"), project_skills: Some(".windsurf/skills") },
    AgentTarget { id: "antigravity", group: "editors", format: "mcp-servers-json", homes: &[".antigravity", "Library/Application Support/Antigravity"], config: "mcp_config.json", skills: "skills", project_config: Some(".antigravity/mcp_config.json"), project_skills: Some(".antigravity/skills") },
    AgentTarget { id: "vscode", group: "editors", format: "vscode-json", homes: &["Library/Application Support/Code/User", "AppData/Roaming/Code/User", ".config/Code/User"], config: "mcp.json", skills: "skills", project_config: Some(".vscode/mcp.json"), project_skills: Some(".vscode/skills") },
    AgentTarget { id: "zed", group: "editors", format: "zed-json", homes: &[".config/zed"], config: "settings.json", skills: "skills", project_config: Some(".zed/settings.json"), project_skills: Some(".zed/skills") },
    AgentTarget { id: "continue", group: "editors", format: "mcp-servers-json", homes: &[".continue"], config: "config.json", skills: "skills", project_config: Some(".continue/config.json"), project_skills: Some(".continue/skills") },
    AgentTarget { id: "opencode", group: "cli", format: "opencode-json", homes: &[".config/opencode"], config: "opencode.json", skills: "skills", project_config: Some("opencode.json"), project_skills: Some(".opencode/skills") },
    AgentTarget { id: "gemini-cli", group: "cli", format: "mcp-servers-json", homes: &[".gemini"], config: "settings.json", skills: "skills", project_config: Some(".gemini/settings.json"), project_skills: Some(".gemini/skills") },
];

fn agent_target(agent_id: &str) -> Result<&'static AgentTarget, String> {
    AGENT_TARGETS.iter().find(|candidate| candidate.id == agent_id).ok_or_else(|| "agent_unknown".to_string())
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
    target.homes.iter().map(|relative| home.join(relative)).find(|candidate| candidate.is_dir())
}

fn skills_present(destination: &Path) -> bool {
    SKILL_NAMES.iter().all(|skill| destination.join(skill).is_dir())
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
            Ok((normalize(&base.join(target.skills)), normalize(&base.join(target.config))))
        }
        Some(folder) => {
            if !folder.is_dir() {
                return Err("folder_not_found".into());
            }
            let config = target.project_config.ok_or("agent_without_folder_scope")?;
            let skills = target.project_skills.ok_or("agent_without_folder_scope")?;
            Ok((normalize(&folder.join(skills)), normalize(&folder.join(config))))
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
        scope: if folder.is_some() { "folder".into() } else { "global".into() },
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
            let Ok(target) = agent_target(&install.agent_id) else { return false };
            let skills = Path::new(&install.skills_path);
            let config = Path::new(&install.config_path);
            // Una carpeta que ya no existe dejó de ser una promesa: se cae de la
            // lista en vez de recrear árboles donde alguien borró su trabajo.
            let alive = install
                .folder
                .as_ref()
                .map_or(skills.parent().is_some_and(Path::is_dir), |folder| Path::new(folder).is_dir());
            if !alive {
                return false;
            }
            let root = PathBuf::from(&install.projects_root);
            sync_bundled_skills_from(resource, skills).is_ok()
                && write_mcp_config(target.format, config, runtime, &root).is_ok()
        })
        .map(|install| ManagedInstall { runtime_path: runtime.to_string_lossy().into_owned(), ..install.clone() })
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

/// Documento recortado a su portada: la primera slide, sus elementos y los
/// descriptores que usa. El inicio dibuja la portada real sin cargar veinte
/// presentaciones completas para pintar miniaturas.
fn cover_document(path: &Path) -> Result<Value, String> {
    let mut document = read_document(path)?;
    let first = document
        .get("slides")
        .and_then(Value::as_array)
        .and_then(|slides| slides.first())
        .cloned()
        .ok_or("cover_without_slides")?;
    let used: Vec<String> = first
        .get("states")
        .and_then(Value::as_array)
        .map(|states| {
            states
                .iter()
                .filter_map(|state| state.get("elementId").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let assets: Vec<String> = first
        .get("states")
        .and_then(Value::as_array)
        .map(|states| {
            states
                .iter()
                .filter_map(|state| state.get("assetId").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if let Some(elements) = document.get_mut("elements").and_then(Value::as_array_mut) {
        elements.retain(|element| {
            element.get("id").and_then(Value::as_str).is_some_and(|id| used.iter().any(|used| used == id))
        });
    }
    if let Some(descriptors) = document.get_mut("assets").and_then(Value::as_array_mut) {
        descriptors.retain(|asset| {
            asset.get("id").and_then(Value::as_str).is_some_and(|id| assets.iter().any(|used| used == id))
        });
    }
    document["slides"] = Value::Array(vec![first]);
    Ok(document)
}

/// Primera carpeta libre para un nombre. Se detiene en un tope alto: si ese
/// número de copias existe, algo más está pasando y seguir probando sólo
/// congelaría la app recorriendo el disco.
fn available_folder(parent: &Path, slug: &str) -> Result<PathBuf, String> {
    for attempt in 1..1000 {
        let candidate = parent.join(if attempt == 1 { slug.to_string() } else { format!("{slug}-{attempt}") });
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("project_folder_unavailable".into())
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
    // Dos presentaciones pueden llamarse igual; dos carpetas no. El nombre que
    // se escribió queda intacto dentro del documento y sólo la carpeta lleva un
    // sufijo, en vez de fallar y perder lo que la persona acababa de definir.
    let path = available_folder(&parent, &slug)?;
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

/// Copia un archivo elegido por la persona dentro de la carpeta del proyecto.
/// El origen puede estar en cualquier parte —lo eligió un diálogo del sistema—
/// pero el destino siempre queda dentro del proyecto, que es lo que hace que la
/// carpeta se pueda mover o comprimir entera sin romper nada.
#[cfg_attr(feature = "desktop", tauri::command)]
fn import_asset(path: String, source_path: String) -> Result<Value, String> {
    let path = project_path(&path)?;
    let bytes = fs::read(&source_path).map_err(|_| "asset_unreadable".to_string())?;
    let mut descriptor = store_asset_bytes(&path, &bytes)?;
    if let Some(name) = Path::new(&source_path).file_name() {
        descriptor["originalFilename"] = Value::String(name.to_string_lossy().into_owned());
    }
    Ok(descriptor)
}

/// Devuelve los bytes del asset para que el host arme su propia URL efímera.
/// El documento guarda identidad y tipo, nunca una ruta absoluta.
#[cfg_attr(feature = "desktop", tauri::command)]
fn read_asset(path: String, asset_id: String, media_type: String) -> Result<Vec<u8>, String> {
    let path = project_path(&path)?;
    let file = asset_file(&path, &asset_id, &media_type)?;
    let bytes = fs::read(&file).map_err(|_| "asset_not_found".to_string())?;
    if sniff_media_type(&bytes) != Some(media_type.as_str()) {
        return Err("asset_media_type_mismatch".into());
    }
    Ok(bytes)
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

/// Borrar manda la carpeta a la papelera del sistema, nunca la destruye. Una
/// presentación es trabajo de alguien: si el borrado fue un error, tiene que
/// poder deshacerse fuera de DEKS. `project_path` ya exige que la carpeta sea
/// una presentación válida, así que esto no puede apuntar a un directorio
/// cualquiera.
fn discard_project(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|error| format!("project_delete_failed:{error}"))
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn delete_project(path: String) -> Result<(), String> {
    discard_project(&project_path(&path)?)
}

#[cfg_attr(feature = "desktop", tauri::command)]
fn read_project_cover(path: String) -> Result<Value, String> {
    cover_document(&project_path(&path)?)
}

/// Qué arneses hay en este equipo. Sólo lee, y sólo devuelve los que existen:
/// un programa que no está instalado no es una decisión que nadie pueda tomar.
#[cfg(feature = "desktop")]
#[tauri::command]
fn detect_agents(app: tauri::AppHandle) -> Result<Vec<DetectedAgent>, String> {
    let home = app.path().home_dir().map_err(|_| "home_dir_unavailable".to_string())?;
    Ok(detect_agents_in(&home))
}

/// Runtime administrado, instalándolo si todavía no estaba. Cualquier
/// instalación en un arnés lo necesita apuntado desde su configuración.
#[cfg(feature = "desktop")]
fn managed_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable".to_string())?;
    let data = app.path().app_local_data_dir().map_err(|_| "data_dir_unavailable".to_string())?;
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
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable".to_string())?;
    let home = app.path().home_dir().map_err(|_| "home_dir_unavailable".to_string())?;
    let runtime = managed_runtime(&app)?;
    let folder_path = folder.as_deref().map(PathBuf::from);
    // Una instalación por carpeta autoriza esa misma carpeta: es lo que la
    // persona acaba de elegir y no hay que preguntarle dos veces por lo mismo.
    let root = folder_path.clone().unwrap_or_else(|| PathBuf::from(&projects_root));
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
    settings
        .managed_installs
        .retain(|existing| !existing.same_target(&install.agent_id, &install.scope, install.folder.as_deref()));
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
    let resources = app.path().resource_dir().map_err(|_| "resources_unavailable".to_string())?;
    let runtime = managed_runtime(&app)?;
    let alive = sync_managed_installs_in(&resources.join("bundled-skills"), &runtime, &settings.managed_installs);
    if alive != settings.managed_installs {
        settings.managed_installs = alive;
        write_settings_to(&directory, &settings)?;
    }
    Ok(settings.managed_installs)
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
            import_asset,
            read_asset,
            set_locale,
            add_source_folder,
            remove_source_folder,
            read_project_cover,
            delete_project,
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
    fn syncing_skills_replaces_the_previous_copy_with_complete_directories() {
        let resource = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        for skill in SKILL_NAMES {
            let skill_path = resource.path().join("skills").join(skill).join("references");
            fs::create_dir_all(&skill_path).unwrap();
            fs::write(resource.path().join("skills").join(skill).join("SKILL.md"), skill).unwrap();
            fs::write(skill_path.join("guide.md"), "guide").unwrap();
        }

        let installed = sync_bundled_skills_from(resource.path(), &destination.path().join("skills")).unwrap();
        assert_eq!(installed, SKILL_NAMES);
        let skills = destination.path().join("skills");
        assert_eq!(fs::read_to_string(skills.join(SKILL_NAMES[0]).join("references/guide.md")).unwrap(), "guide");

        // Una versión nueva reemplaza la copia anterior entera: nada de la
        // instalación vieja sobrevive dentro de la carpeta de una skill.
        fs::write(resource.path().join("skills").join(SKILL_NAMES[0]).join("SKILL.md"), "v2").unwrap();
        fs::remove_file(resource.path().join("skills").join(SKILL_NAMES[0]).join("references/guide.md")).unwrap();
        sync_bundled_skills_from(resource.path(), &skills).unwrap();
        assert_eq!(fs::read_to_string(skills.join(SKILL_NAMES[0]).join("SKILL.md")).unwrap(), "v2");
        assert!(!skills.join(SKILL_NAMES[0]).join("references/guide.md").exists());
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

    #[test]
    fn two_presentations_with_the_same_name_get_their_own_folder() {
        let root = tempfile::tempdir().unwrap();
        let parent = fs::canonicalize(root.path()).unwrap();

        let first = available_folder(&parent, "mi-presentacion").unwrap();
        fs::create_dir(&first).unwrap();
        let second = available_folder(&parent, "mi-presentacion").unwrap();

        assert_eq!(first.file_name().unwrap(), "mi-presentacion");
        assert_eq!(second.file_name().unwrap(), "mi-presentacion-2");
        assert_ne!(first, second);
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
        assert_eq!(claude.config_path, home.path().join(".claude.json").to_string_lossy());
        assert_eq!(claude.skills_path, home.path().join(".claude/skills").to_string_lossy());
    }

    #[test]
    fn installing_a_harness_writes_skills_and_the_mcp_entry_together() {
        let resource = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let runtime = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        seed_skill_bundle(resource.path());

        assert_eq!(
            install_agent_in(resource.path(), home.path(), runtime.path(), "claude-code", None, root.path())
                .unwrap_err(),
            "agent_not_installed",
        );

        fs::create_dir_all(home.path().join(".claude")).unwrap();
        let install =
            install_agent_in(resource.path(), home.path(), runtime.path(), "claude-code", None, root.path()).unwrap();

        assert_eq!(install.scope, "global");
        assert!(install.folder.is_none());
        assert!(home.path().join(".claude/skills").join(SKILL_NAMES[0]).join("SKILL.md").is_file());

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
        assert_eq!(install.folder.as_deref().unwrap(), folder.path().to_string_lossy());
        assert!(folder.path().join(".claude/skills").join(SKILL_NAMES[0]).join("SKILL.md").is_file());
        let config: Value = serde_json::from_slice(&fs::read(folder.path().join(".mcp.json")).unwrap()).unwrap();
        assert_eq!(
            config["mcpServers"]["deks"]["env"]["DEKS_PROJECTS_ROOT"],
            Value::String(folder.path().to_string_lossy().into_owned()),
        );

        // La instalación global no se tocó: son alcances distintos.
        assert!(!home.path().join(".claude/skills").join(SKILL_NAMES[0]).is_dir());
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
        let skill = folder.path().join(".claude/skills").join(SKILL_NAMES[0]).join("SKILL.md");
        assert_eq!(fs::read_to_string(&skill).unwrap(), SKILL_NAMES[0]);

        // Una versión nueva de la app trae skills nuevas: la carpeta mantenida
        // las recibe sin que nadie vuelva a instalarlas.
        fs::write(resource.path().join("skills").join(SKILL_NAMES[0]).join("SKILL.md"), "v2").unwrap();
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
        assert_eq!(fs::read_to_string(path.join("package.json")).unwrap(), "{\"edited\":true}");
    }

    #[test]
    fn a_cover_carries_only_the_first_slide_and_what_it_draws() {
        let root = tempfile::tempdir().unwrap();
        let path = seed_project(
            root.path(),
            "deck",
            serde_json::json!({
                "format": "deks",
                "revision": 4,
                "name": "Deck",
                "canvas": { "width": 1920, "height": 1080 },
                "assets": [{ "id": "asset-1" }, { "id": "asset-2" }],
                "elements": [{ "id": "element-1" }, { "id": "element-2" }],
                "slides": [
                    { "id": "slide-1", "states": [{ "elementId": "element-1", "assetId": "asset-1" }] },
                    { "id": "slide-2", "states": [{ "elementId": "element-2" }] },
                ],
            }),
        );

        let cover = cover_document(&path).unwrap();
        assert_eq!(cover["slides"].as_array().unwrap().len(), 1);
        assert_eq!(cover["slides"][0]["id"], "slide-1");
        assert_eq!(cover["elements"].as_array().unwrap(), &vec![serde_json::json!({ "id": "element-1" })]);
        assert_eq!(cover["assets"].as_array().unwrap(), &vec![serde_json::json!({ "id": "asset-1" })]);
        // La revisión y el lienzo viajan intactos: la portada se dibuja con el
        // mismo renderer que el editor.
        assert_eq!(cover["revision"], 4);
        assert_eq!(cover["canvas"]["width"], 1920);
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

        let settings = Settings { locale: Some("en".into()), source_folders: vec!["/tmp/decks".into()], managed_installs: Vec::new() };
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

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn an_asset_is_typed_by_its_bytes_and_never_by_its_extension() {
        let project = tempfile::tempdir().unwrap();
        let mut png = PNG.to_vec();
        png.extend_from_slice(b"rest of the image");

        let descriptor = store_asset_bytes(project.path(), &png).unwrap();
        assert_eq!(descriptor["mediaType"], "image/png");
        let id = descriptor["id"].as_str().unwrap();
        assert!(project.path().join(ASSETS_DIR).join(format!("{id}.png")).is_file());

        // Un archivo que se llama imagen pero no lo es queda fuera del documento.
        assert_eq!(store_asset_bytes(project.path(), b"<html>nope</html>").unwrap_err(), "asset_media_type_unsupported");
        assert_eq!(store_asset_bytes(project.path(), b"").unwrap_err(), "asset_empty");
    }

    #[test]
    fn asset_paths_stay_inside_the_project_and_reject_a_forged_id() {
        let project = tempfile::tempdir().unwrap();
        assert_eq!(asset_file(project.path(), "../escape", "image/png").unwrap_err(), "asset_id_invalid");
        assert_eq!(asset_file(project.path(), "a/b", "image/png").unwrap_err(), "asset_id_invalid");
        assert_eq!(asset_file(project.path(), "ok-1", "text/html").unwrap_err(), "asset_media_type_unsupported");
        assert!(asset_file(project.path(), "ok-1", "image/webp").unwrap().ends_with("assets/ok-1.webp"));
    }

    #[test]
    fn an_oversized_asset_is_refused_before_touching_the_disk() {
        let project = tempfile::tempdir().unwrap();
        let mut huge = PNG.to_vec();
        huge.resize(MAX_ASSET_BYTES + 1, 0);
        assert_eq!(store_asset_bytes(project.path(), &huge).unwrap_err(), "asset_too_large");
        assert!(!project.path().join(ASSETS_DIR).exists());
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
