import { createHash, randomUUID } from "node:crypto";
import { constants, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  applyDeksCommand,
  assertDeksDocument,
  createDeksFile,
  DEKS_IMAGE_LIMITS,
  inspectAndNormalizeDeksImage,
  migrateDeksDocument,
  normalizeDeksFileAssets,
  readDeksFile,
  sniffDeksImageMediaType,
} from "@deks-js/document";
import {
  assertDeksArchiveExpandedSize,
  assertDeksArchivePhysicalSize,
} from "../shared/deks-file-limits.mjs";

const LEGACY_DOCUMENT_FILE = "document.deks.json";
const LEGACY_LOCK_FILE = "project.lock";
const LEGACY_ASSETS_DIR = "assets";
const LEGACY_CHANGES_DIR = "changes";
const ASSET_EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
});

export function sniffAsset(bytes) {
  const mediaType = sniffDeksImageMediaType(new Uint8Array(bytes));
  return mediaType ? { mediaType, extension: ASSET_EXTENSIONS[mediaType] } : undefined;
}

export function assetExtension(mediaType) {
  return ASSET_EXTENSIONS[mediaType];
}

export const DEKS_COMMAND_TYPES = Object.freeze([
  "update-document",
  "define-asset",
  "remove-asset",
  "define-element",
  "update-element-identity",
  "delete-element",
  "create-slide",
  "update-slide",
  "reorder-slides",
  "delete-slide",
  "add-element-state",
  "update-element-state",
  "remove-element-state",
  "set-motion",
  "clear-motion",
]);
const DEKS_COMMAND_TYPE_SET = new Set(DEKS_COMMAND_TYPES);
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function assertInside(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || resolve(root, pathFromRoot) !== candidate) {
    throw new Error("path_not_authorized");
  }
}

async function atomicWriteBytes(path, value) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

async function atomicWriteJson(path, value) {
  await atomicWriteBytes(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      await handle.writeFile(`pid=${process.pid} created_at=${new Date().toISOString()}\n`, "utf8");
      await handle.close();
      return async () => { await unlink(lockPath).catch(() => undefined); };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const age = await stat(lockPath).then((metadata) => Date.now() - metadata.mtimeMs).catch(() => 0);
      if (age > 30_000) await unlink(lockPath).catch(() => undefined);
      else await wait(20);
    }
  }
  throw new Error("lock_timeout");
}

function touchedIds(commands) {
  const slideIds = new Set();
  const elementIds = new Set();
  for (const command of commands) {
    if (command.slideId) slideIds.add(command.slideId);
    if (command.slide?.id) slideIds.add(command.slide.id);
    if (command.fromSlideId) slideIds.add(command.fromSlideId);
    if (command.toSlideId) slideIds.add(command.toSlideId);
    if (command.elementId) elementIds.add(command.elementId);
    if (command.element?.id) elementIds.add(command.element.id);
    if (command.state?.elementId) elementIds.add(command.state.elementId);
    if (Array.isArray(command.slideIds)) for (const id of command.slideIds) slideIds.add(id);
  }
  return { slideIds: [...slideIds], elementIds: [...elementIds] };
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateIdempotencyKey(idempotencyKey) {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw new Error("invalid_idempotency_key");
  }
}

function directFileSidecars(filePath) {
  const prefix = `.${basename(filePath)}`;
  return {
    lockPath: join(dirname(filePath), `${prefix}.lock`),
    stateDirectory: join(dirname(filePath), `${prefix}.state`),
  };
}

function selectPackagedAssets(document, availableAssets) {
  const embeddedIds = new Set(document.assets.filter(({ kind }) => kind === "embedded").map(({ id }) => id));
  return availableAssets.filter(({ id }) => embeddedIds.has(id));
}

async function readLegacyAssetBounded(path, mediaType) {
  const maxBytes = mediaType === DEKS_IMAGE_LIMITS.svgMediaType
    ? DEKS_IMAGE_LIMITS.maxSvgBytes : DEKS_IMAGE_LIMITS.maxRasterBytes;
  const handle = await open(path, constants.O_RDONLY);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("asset_unreadable");
    if (metadata.size > maxBytes) throw new Error("asset_too_large");
    const buffer = Buffer.allocUnsafe(Math.min(maxBytes + 1, metadata.size + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error("asset_too_large");
    return new Uint8Array(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export class ProjectStore {
  #root;

  static async fromRoot(root) {
    const canonical = await realpath(root);
    return new ProjectStore(canonical);
  }

  constructor(root) {
    this.#root = root;
  }

  async #loadDirectFile(filePath) {
    const canonical = await realpath(filePath);
    assertInside(this.#root, canonical);
    const metadata = await stat(canonical);
    if (!metadata.isFile()) throw new Error("presentation_not_found");
    assertDeksArchivePhysicalSize(metadata.size);
    const { document, assets: packagedAssets } = await readDeksFile(await readFile(canonical));
    assertDeksArchiveExpandedSize(document, packagedAssets);
    const assets = normalizeDeksFileAssets(document, packagedAssets);
    const sidecars = directFileSidecars(canonical);
    return { kind: "file", filePath: canonical, document, assets, ...sidecars };
  }

  async #loadLegacyFolder(projectPath) {
    const canonical = await realpath(projectPath);
    assertInside(this.#root, canonical);
    const documentPath = join(canonical, LEGACY_DOCUMENT_FILE);
    const { document } = migrateDeksDocument(JSON.parse(await readFile(documentPath, "utf8")));
    const assets = [];
    for (const descriptor of document.assets ?? []) {
      if (descriptor.kind !== "embedded") continue;
      const extension = assetExtension(descriptor.mediaType);
      if (!extension) throw new Error("asset_media_type_unsupported");
      const assetPath = join(canonical, LEGACY_ASSETS_DIR, `${descriptor.id}.${extension}`);
      try {
        assertInside(canonical, assetPath);
        const inspected = inspectAndNormalizeDeksImage(
          await readLegacyAssetBounded(assetPath, descriptor.mediaType),
          descriptor.mediaType,
        );
        assets.push({
          id: descriptor.id,
          mediaType: inspected.mediaType,
          ...(descriptor.originalFilename ? { originalFilename: descriptor.originalFilename } : {}),
          bytes: inspected.bytes,
        });
      } catch (error) {
        // A missing legacy byte file remains an unresolved image. Existing
        // bytes, however, must satisfy the same safe contract as `.deks`.
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return {
      kind: "legacy",
      projectPath: canonical,
      documentPath,
      document,
      assets,
      lockPath: join(canonical, LEGACY_LOCK_FILE),
      stateDirectory: join(canonical, LEGACY_CHANGES_DIR),
    };
  }

  async #discoverProjects() {
    const entries = (await readdir(this.#root, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const projects = [];

    // El archivo portable es la fuente primaria. Carpetas expandidas se leen sólo
    // como compatibilidad para no invalidar proyectos existentes ni borrarlos.
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".deks")) continue;
      try {
        projects.push(await this.#loadDirectFile(join(this.#root, entry.name)));
      } catch {
        // Raíces autorizadas pueden contener archivos corruptos o ajenos.
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const legacy = await this.#loadLegacyFolder(join(this.#root, entry.name));
        if (!projects.some(({ kind, document }) => kind === "file" && document.id === legacy.document.id)) {
          projects.push(legacy);
        }
      } catch {
        // Incluye sidecars ocultos y carpetas que no son proyectos DEKS.
      }
    }
    return projects;
  }

  async listPresentations() {
    return (await this.#discoverProjects()).map(({ document }) => ({
      id: document.id,
      name: document.name,
      revision: document.revision,
    }));
  }

  async findProject(presentationId) {
    const matches = (await this.#discoverProjects()).filter(({ document }) => document.id === presentationId);
    if (matches.length === 0) throw new Error("presentation_not_found");
    if (matches.length > 1) throw new Error("presentation_id_ambiguous");
    return matches[0];
  }

  async #reloadProject(project) {
    return project.kind === "file"
      ? this.#loadDirectFile(project.filePath)
      : this.#loadLegacyFolder(project.projectPath);
  }

  async getPresentation(presentationId) {
    return (await this.findProject(presentationId)).document;
  }

  async readAssets(presentationId) {
    const project = await this.findProject(presentationId);
    return Object.fromEntries(project.assets.map((asset) => [asset.id, {
      mediaType: asset.mediaType,
      base64: Buffer.from(asset.bytes).toString("base64"),
    }]));
  }

  async #writeProject(project, document, assets, additionalAssets) {
    if (project.kind === "file") {
      assertDeksArchiveExpandedSize(document, assets);
      const archive = await createDeksFile(document, assets);
      assertDeksArchivePhysicalSize(archive.bytes);
      await atomicWriteBytes(project.filePath, archive.bytes);
      return;
    }

    if (additionalAssets.length > 0) {
      const configuredAssetsDirectory = join(project.projectPath, LEGACY_ASSETS_DIR);
      await mkdir(configuredAssetsDirectory, { recursive: true });
      const assetsDirectory = await realpath(configuredAssetsDirectory);
      assertInside(project.projectPath, assetsDirectory);
      for (const asset of additionalAssets) {
        const extension = assetExtension(asset.mediaType);
        if (!extension) throw new Error("asset_media_type_unsupported");
        const destination = join(assetsDirectory, `${asset.id}.${extension}`);
        assertInside(project.projectPath, destination);
        await atomicWriteBytes(destination, asset.bytes);
      }
    }
    await atomicWriteJson(project.documentPath, document);
  }

  async #applyTransaction({
    presentationId,
    expectedRevision,
    idempotencyKey,
    commands,
    request,
    additionalAssets = [],
    resultFields = {},
  }) {
    if (!Array.isArray(commands) || commands.length === 0) throw new Error("commands_required");
    validateIdempotencyKey(idempotencyKey);
    const project = await this.findProject(presentationId);
    await mkdir(project.stateDirectory, { recursive: true });
    const stateDirectory = await realpath(project.stateDirectory);
    assertInside(project.kind === "file" ? this.#root : project.projectPath, stateDirectory);
    const receiptName = `idempotency-${createHash("sha256").update(idempotencyKey).digest("hex")}.json`;
    const receiptPath = join(stateDirectory, receiptName);
    const requestHash = hashJson(request);
    const prior = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => undefined);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error("idempotency_key_reused");
      return prior.result;
    }

    const release = await acquireLock(project.lockPath);
    try {
      const concurrentPrior = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => undefined);
      if (concurrentPrior) {
        if (concurrentPrior.requestHash !== requestHash) throw new Error("idempotency_key_reused");
        return concurrentPrior.result;
      }

      const currentProject = await this.#reloadProject(project);
      if (currentProject.document.id !== presentationId) throw new Error("presentation_not_found");
      if (currentProject.document.revision !== expectedRevision) throw new Error("revision_conflict");

      let next = currentProject.document;
      for (const command of commands) {
        if (!command || typeof command !== "object" || !DEKS_COMMAND_TYPE_SET.has(command.type)) {
          throw new Error("unsupported_command");
        }
        next = applyDeksCommand(next, command).document;
      }
      next = { ...next, revision: expectedRevision + 1 };
      assertDeksDocument(next);

      const assetsById = new Map(currentProject.assets.map((asset) => [asset.id, asset]));
      for (const asset of additionalAssets) assetsById.set(asset.id, asset);
      const packagedAssets = selectPackagedAssets(next, [...assetsById.values()]);
      const changed = touchedIds(commands);
      const result = {
        presentationId,
        revision: next.revision,
        changedSlideIds: changed.slideIds,
        changedElementIds: changed.elementIds,
        document: next,
        ...resultFields,
      };

      await this.#writeProject(currentProject, next, packagedAssets, additionalAssets);
      await atomicWriteJson(join(stateDirectory, `${next.revision}.json`), {
        presentationId,
        revision: next.revision,
        origin: "agent",
        changedSlideIds: changed.slideIds,
        changedElementIds: changed.elementIds,
      });
      await atomicWriteJson(receiptPath, { presentationId, requestHash, result });
      return result;
    } finally {
      await release();
    }
  }

  async addAsset({ presentationId, expectedRevision, idempotencyKey, base64, originalFilename }) {
    if (typeof base64 !== "string" || base64.length === 0) throw new Error("asset_required");
    if (base64.length > Math.ceil(DEKS_IMAGE_LIMITS.maxRasterBytes / 3) * 4) throw new Error("asset_too_large");
    if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error("asset_not_base64");
    const bytes = Buffer.from(base64, "base64");
    const inspected = inspectAndNormalizeDeksImage(new Uint8Array(bytes));
    validateIdempotencyKey(idempotencyKey);

    const contentHash = createHash("sha256").update(inspected.bytes).digest("hex");
    const assetId = `asset-${createHash("sha256")
      .update(`${presentationId}\0${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`;
    const asset = {
      id: assetId,
      kind: "embedded",
      mediaType: inspected.mediaType,
      ...(typeof originalFilename === "string" && originalFilename.length > 0
        ? { originalFilename: originalFilename.slice(0, 200) }
        : {}),
    };
    const packagedAsset = {
      id: assetId,
      mediaType: inspected.mediaType,
      bytes: inspected.bytes,
    };

    return this.#applyTransaction({
      presentationId,
      expectedRevision,
      idempotencyKey,
      commands: [{ type: "define-asset", asset }],
      request: { operation: "add_asset", presentationId, asset, contentHash },
      additionalAssets: [packagedAsset],
      resultFields: { asset },
    });
  }

  async applyCommands({ presentationId, expectedRevision, idempotencyKey, commands }) {
    return this.#applyTransaction({
      presentationId,
      expectedRevision,
      idempotencyKey,
      commands,
      request: { operation: "apply_commands", presentationId, commands },
    });
  }
}
