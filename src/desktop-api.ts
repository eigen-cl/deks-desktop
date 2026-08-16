import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { DeksDocument } from "@deks-js/document";
import type { OpenProject, ProjectChanged } from "./model";

export async function chooseDirectory(title: string): Promise<string | undefined> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : undefined;
}

export function createProject(parentPath: string, name: string, document: DeksDocument): Promise<OpenProject> {
  return invoke("create_project", { parentPath, name, document });
}

export function openProject(path: string): Promise<OpenProject> {
  return invoke("open_project", { path });
}

export function saveProject(
  path: string,
  expectedRevision: number,
  document: DeksDocument,
  changedSlideIds: string[],
  changedElementIds: string[],
): Promise<OpenProject> {
  return invoke("save_project", {
    path,
    expectedRevision,
    document,
    changedSlideIds,
    changedElementIds,
  });
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
