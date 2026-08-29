import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createDeksFile,
  DEKS_FILE_MEDIA_TYPE,
  inspectAndNormalizeDeksAsset,
  inspectAndNormalizeDeksImage,
  normalizeDeksFileAssets,
  readDeksFile,
  type DeksDocument,
  type DeksFileAsset,
} from "@deks-js/document";
import { toCanonicalDocumentResult } from "./legacy-document";
import type { ImportedAsset } from "./editor/elements";
import type { LocalePreference } from "./i18n";
import type {
  DeksFileChanged,
  DeksFileEntry,
  DetectedAgent,
  ManagedInstall,
  OpenProject,
  ProjectSummary,
  Workspace,
} from "./model";
import {
  assertDeksArchiveExpandedSize,
  assertDeksArchivePhysicalSize,
} from "../shared/deks-file-limits.mjs";

interface HostDeksBytes {
  path: string;
  bytes: number[];
  fingerprint: string;
}

interface LegacyProject {
  path: string;
  document: unknown;
}

export interface ImportedAssetBytes extends ImportedAsset {
  bytes: Uint8Array;
}

export function readWorkspace(): Promise<Workspace> {
  return invoke<Workspace>("read_workspace");
}

/** Rust descubre archivos; Core es quien interpreta su manifest. */
export async function listProjects(roots: string[]): Promise<ProjectSummary[]> {
  const entries = await invoke<DeksFileEntry[]>("list_deks_files", { roots });
  const summaries = await Promise.all(entries.map(async (entry) => {
    try {
      const project = await openProject(entry.path);
      return {
        path: project.path,
        root: entry.root,
        name: project.document.name,
        revision: project.document.revision,
        slideCount: project.document.slides.length,
        updatedAtMs: entry.updatedAtMs,
        canvas: project.document.canvas,
        background: project.document.slides[0]?.background ?? null,
      } satisfies ProjectSummary;
    } catch {
      return undefined;
    }
  }));
  return summaries.reduce<ProjectSummary[]>((valid, summary) => {
    if (summary) valid.push(summary);
    return valid;
  }, []);
}

export function setLocale(locale: LocalePreference): Promise<void> {
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

export async function chooseDeksFile(title: string): Promise<string | undefined> {
  const selected = await open({
    directory: false,
    multiple: false,
    title,
    filters: [{ name: "DEKS", extensions: ["deks"] }],
  });
  return typeof selected === "string" ? selected : undefined;
}

async function decodeHostFile(record: HostDeksBytes): Promise<OpenProject> {
  assertDeksArchivePhysicalSize(record.bytes.length);
  const archive = await readDeksFile(new Uint8Array(record.bytes));
  assertDeksArchiveExpandedSize(archive.document, archive.assets);
  return {
    path: record.path,
    document: archive.document,
    // Core validates every packaged image and canonicalizes safe SVG bytes.
    assets: normalizeDeksFileAssets(archive.document, archive.assets),
    fingerprint: record.fingerprint,
    warnings: archive.warnings,
  };
}

export async function createProject(parentPath: string, name: string, document: DeksDocument): Promise<OpenProject> {
  assertDeksArchiveExpandedSize(document, []);
  const archive = await createDeksFile(document);
  assertDeksArchivePhysicalSize(archive.bytes);
  const written = await invoke<HostDeksBytes>("create_deks_file", {
    parentPath,
    filename: archive.filename,
    bytes: Array.from(archive.bytes),
  });
  return decodeHostFile(written);
}

export function openProject(path: string): Promise<OpenProject> {
  return invoke<HostDeksBytes>("read_deks_file", { path }).then(decodeHostFile);
}

export async function saveProject(
  project: Pick<OpenProject, "path" | "assets" | "fingerprint">,
  expectedRevision: number,
  document: DeksDocument,
): Promise<OpenProject> {
  if (document.revision !== expectedRevision + 1) throw new Error("next_revision_invalid");
  const embedded = new Set(document.assets.filter(({ kind }) => kind === "embedded").map(({ id }) => id));
  const assets = normalizeDeksFileAssets(document, project.assets.filter(({ id }) => embedded.has(id)));
  assertDeksArchiveExpandedSize(document, assets);
  const archive = await createDeksFile(document, assets);
  assertDeksArchivePhysicalSize(archive.bytes);
  const written = await invoke<HostDeksBytes>("write_deks_file", {
    path: project.path,
    expectedFingerprint: project.fingerprint,
    bytes: Array.from(archive.bytes),
  });
  const reopened = await decodeHostFile(written);
  if (reopened.document.revision !== document.revision) throw new Error("deks_write_verification_failed");
  return reopened;
}

/**
 * Convierte una carpeta antigua a un archivo vecino. El ZIP se valida antes y
 * después de escribir; la carpeta fuente queda intacta.
 */
export async function migrateLegacyProject(path: string): Promise<OpenProject> {
  const legacy = await invoke<LegacyProject>("open_project", { path });
  const migration = toCanonicalDocumentResult(legacy.document);
  const document = migration.document;
  const assets: DeksFileAsset[] = [];
  for (const descriptor of document.assets) {
    if (descriptor.kind !== "embedded") continue;
    const bytes = await invoke<number[]>("read_asset", {
      path: legacy.path,
      assetId: descriptor.id,
      mediaType: descriptor.mediaType,
    });
    const inspected = inspectAndNormalizeDeksAsset(new Uint8Array(bytes), descriptor.mediaType);
    assets.push({ id: descriptor.id, mediaType: inspected.mediaType, bytes: inspected.bytes, contentHash: "" });
  }
  assertDeksArchiveExpandedSize(document, assets);
  const archive = await createDeksFile(document, assets);
  assertDeksArchivePhysicalSize(archive.bytes);
  await readDeksFile(archive.bytes);
  const written = await invoke<HostDeksBytes>("migrate_legacy_folder", {
    path: legacy.path,
    bytes: Array.from(archive.bytes),
  });
  const reopened = await decodeHostFile(written);
  if (JSON.stringify(reopened.document) !== JSON.stringify(document)) {
    throw new Error("legacy_migration_verification_failed");
  }
  return {
    ...reopened,
    warnings: [...migration.warnings, ...reopened.warnings],
  };
}

export function readProjectCover(path: string): Promise<DeksDocument> {
  return openProject(path).then(({ document }) => {
    const first = document.slides[0];
    const stateIds = new Set(first?.states.map(({ elementId }) => elementId) ?? []);
    const assetIds = new Set(first?.states.flatMap((state) => "assetId" in state ? [state.assetId] : []) ?? []);
    if (first?.narration?.audio) assetIds.add(first.narration.audio.assetId);
    return {
      ...document,
      elements: document.elements.filter(({ id }) => stateIds.has(id)),
      assets: document.assets.filter(({ id }) => assetIds.has(id)),
      slides: first ? [first] : [],
    };
  });
}

export function deleteProject(path: string): Promise<void> {
  return invoke("delete_deks_file", { path });
}

export function detectAgents(): Promise<DetectedAgent[]> {
  return invoke<DetectedAgent[]>("detect_agents");
}

export function installAgent(agentId: string, projectsRoot: string, folder?: string): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("install_agent", { agentId, projectsRoot, folder: folder ?? null });
}

export function forgetManagedInstall(
  agentId: string,
  scope: "global" | "folder",
  folder: string | null,
): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("forget_managed_install", { agentId, scope, folder });
}

export function syncManagedInstalls(): Promise<ManagedInstall[]> {
  return invoke<ManagedInstall[]>("sync_managed_installs");
}

export function watchProject(path: string): Promise<void> {
  return invoke("watch_deks_file", { path });
}

export function onProjectChanged(handler: (event: DeksFileChanged) => void): Promise<UnlistenFn> {
  return listen<DeksFileChanged>("deks://file-changed", ({ payload }) => handler(payload));
}

export function importAsset(sourcePath: string): Promise<ImportedAssetBytes> {
  return invoke<Omit<ImportedAssetBytes, "bytes"> & { bytes: number[] }>("read_image_file", { sourcePath }).then((asset) => {
    const inspected = inspectAndNormalizeDeksImage(new Uint8Array(asset.bytes), asset.mediaType);
    return { ...asset, mediaType: inspected.mediaType, bytes: inspected.bytes };
  });
}

/**
 * La grabación ya fue convertida a WAV por el WebView. Core vuelve a olfatear
 * los bytes antes de que el host los agregue al conjunto que empaquetará: el
 * MIME declarado por la UI nunca es autoridad.
 */
export function importNarrationAsset(bytes: Uint8Array): ImportedAssetBytes & { mediaType: "audio/wav" } {
  const inspected = inspectAndNormalizeDeksAsset(bytes, "audio/wav");
  if (inspected.mediaType !== "audio/wav") throw new Error("asset_media_type_unsupported");
  return {
    id: `narration-${crypto.randomUUID()}`,
    mediaType: inspected.mediaType,
    originalFilename: "narration.wav",
    bytes: inspected.bytes,
  };
}

export async function chooseImage(title: string, filterName: string): Promise<string | undefined> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: filterName, extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
  });
  return typeof selected === "string" ? selected : undefined;
}

export { DEKS_FILE_MEDIA_TYPE };
