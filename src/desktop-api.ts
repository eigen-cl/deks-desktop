import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { DeksDocument } from "@deks-js/document";
import { toCanonicalDocument } from "./legacy-document";
import type { ImportedAsset } from "./editor/elements";
import type { Locale } from "./i18n";
import type { DetectedAgent, ManagedInstall, OpenProject, ProjectChanged, ProjectSummary, Workspace } from "./model";

/** Raíz por defecto, idioma guardado y carpetas fuente en una sola llamada. */
export function readWorkspace(): Promise<Workspace> {
  return invoke<Workspace>("read_workspace");
}

export function listProjects(roots: string[]): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("list_projects", { roots });
}

export function setLocale(locale: Locale): Promise<void> {
  return invoke("set_locale", { locale });
}

export function addSourceFolder(path: string): Promise<string[]> {
  return invoke<string[]>("add_source_folder", { path });
}

export function removeSourceFolder(path: string): Promise<string[]> {
  return invoke<string[]>("remove_source_folder", { path });
}

export async function chooseDirectory(title: string): Promise<string | undefined> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : undefined;
}

export function createProject(parentPath: string, name: string, document: DeksDocument): Promise<OpenProject> {
  return invoke<OpenProject>("create_project", { parentPath, name, document }).then(canonical);
}

export function openProject(path: string): Promise<OpenProject> {
  // Una carpeta escrita por una versión anterior sigue siendo del usuario: se
  // migra al contrato canónico al abrirla, no se rechaza.
  return invoke<OpenProject>("open_project", { path }).then(canonical);
}

function canonical(project: OpenProject): OpenProject {
  return { ...project, document: toCanonicalDocument(project.document) };
}

export function saveProject(
  path: string,
  expectedRevision: number,
  document: DeksDocument,
  changedSlideIds: string[],
  changedElementIds: string[],
): Promise<OpenProject> {
  return invoke<OpenProject>("save_project", {
    path,
    expectedRevision,
    document,
    changedSlideIds,
    changedElementIds,
  }).then(canonical);
}

/**
 * Documento recortado a su portada. El inicio dibuja la primera slide con el
 * mismo renderer que el editor, pero sólo de las tarjetas que llegan a verse.
 */
export function readProjectCover(path: string): Promise<DeksDocument> {
  return invoke<DeksDocument>("read_project_cover", { path }).then(toCanonicalDocument);
}

/**
 * Manda la carpeta de la presentación a la papelera del sistema. No la
 * destruye: si el borrado fue un error, se recupera fuera de DEKS.
 */
export function deleteProject(path: string): Promise<void> {
  return invoke("delete_project", { path });
}

/** Qué arneses hay instalados en este equipo. Sólo lee, y sólo los presentes. */
export function detectAgents(): Promise<DetectedAgent[]> {
  return invoke<DetectedAgent[]>("detect_agents");
}

/**
 * Instala MCP y skills juntos en un arnés. Sin `folder` la instalación es
 * global; con `folder` queda dentro de esa carpeta y la autoriza a ella.
 */
export function installAgent(
  agentId: string,
  projectsRoot: string,
  folder?: string,
): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("install_agent", { agentId, projectsRoot, folder: folder ?? null });
}

/** Deja de mantener una instalación. No borra nada: sólo deja de actualizarla. */
export function forgetManagedInstall(
  agentId: string,
  scope: "global" | "folder",
  folder: string | null,
): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("forget_managed_install", { agentId, scope, folder });
}

/** Reinstala skills y configuración en todo lo que el host mantiene al día. */
export function syncManagedInstalls(): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("sync_managed_installs");
}

export function watchProject(path: string): Promise<void> {
  return invoke("watch_project", { path });
}

export function onProjectChanged(handler: (event: ProjectChanged) => void): Promise<UnlistenFn> {
  return listen<ProjectChanged>("deks://presentation-changed", ({ payload }) => handler(payload));
}

/** Copia un archivo del sistema dentro de la carpeta del proyecto. */
export function importAsset(path: string, sourcePath: string): Promise<ImportedAsset> {
  return invoke<ImportedAsset>("import_asset", { path, sourcePath });
}

export function readAsset(path: string, assetId: string, mediaType: string): Promise<number[]> {
  return invoke<number[]>("read_asset", { path, assetId, mediaType });
}

export async function chooseImage(title: string): Promise<string | undefined> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: "Imagen", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
  });
  return typeof selected === "string" ? selected : undefined;
}
