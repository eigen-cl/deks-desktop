import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { DeksDocument } from "@deks-js/document";
import { toCanonicalDocument } from "./legacy-document";
import type { OpenProject, ProjectChanged } from "./model";

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

export function watchProject(path: string): Promise<void> {
  return invoke("watch_project", { path });
}

export function installBundledSkills(destinationPath: string): Promise<string[]> {
  return invoke("install_bundled_skills", { destinationPath });
}

export function installBundledMcp(destinationPath: string): Promise<string> {
  return invoke("install_bundled_mcp", { destinationPath });
}

export function onProjectChanged(handler: (event: ProjectChanged) => void): Promise<UnlistenFn> {
  return listen<ProjectChanged>("deks://presentation-changed", ({ payload }) => handler(payload));
}
