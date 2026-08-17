import { createHash, randomUUID } from "node:crypto";
import { constants, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { applyDeksCommand, assertDeksDocument } from "@deks-js/document";

const DOCUMENT_FILE = "document.deks.json";
const LOCK_FILE = "project.lock";
const ASSETS_DIR = "assets";
/** Mismo techo que el host: un asset que Desktop rechaza no puede entrar por MCP. */
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
/**
 * El tipo lo deciden los bytes. Un agente puede equivocarse —o ser inducido a
 * equivocarse— al declarar `media_type`, y un descriptor mentiroso rompe el
 * documento en cualquier host que lo abra después.
 */
const ASSET_SIGNATURES = [
  { mediaType: "image/png", extension: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mediaType: "image/jpeg", extension: "jpg", test: (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
  { mediaType: "image/gif", extension: "gif", test: (b) => b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a" },
  { mediaType: "image/webp", extension: "webp", test: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

export function sniffAsset(bytes) {
  return ASSET_SIGNATURES.find((candidate) => candidate.test(bytes));
}

/** La extensión se deriva del tipo, así que resolver sólo necesita el descriptor. */
export function assetExtension(mediaType) {
  return ASSET_SIGNATURES.find((candidate) => candidate.mediaType === mediaType)?.extension;
}
/**
 * Vocabulario canónico de `@deks-js/document`. El contrato 1.0 separa identidad
 * de checkpoint, así que un elemento se define una vez (`define-element`) y su
 * geometría vive por slide (`add-element-state` / `update-element-state`).
 */
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
  "set-transition",
]);
const DEKS_COMMAND_TYPE_SET = new Set(DEKS_COMMAND_TYPES);

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function assertInside(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || resolve(root, pathFromRoot) !== candidate) {
    throw new Error("path_not_authorized");
  }
}

async function atomicWrite(path, value) {
  const temporary = join(dirname(path), `.${DOCUMENT_FILE}.${process.pid}.${randomUUID()}.tmp`);
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

async function acquireLock(projectPath) {
  const lockPath = join(projectPath, LOCK_FILE);
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
    // Formas propias del contrato canónico: un checkpoint lleva el elemento
    // dentro de `state`, y reordenar toca varias slides a la vez.
    if (command.state?.elementId) elementIds.add(command.state.elementId);
    if (Array.isArray(command.slideIds)) for (const id of command.slideIds) slideIds.add(id);
  }
  return { slideIds: [...slideIds], elementIds: [...elementIds] };
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

  async listPresentations() {
    const directories = await readdir(this.#root, { withFileTypes: true });
    const results = [];
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      try {
        const projectPath = await realpath(join(this.#root, entry.name));
        assertInside(this.#root, projectPath);
        const document = JSON.parse(await readFile(join(projectPath, DOCUMENT_FILE), "utf8"));
        assertDeksDocument(document);
        results.push({ id: document.id, name: document.name, revision: document.revision });
      } catch {
        // A root may contain unrelated folders. They are intentionally invisible to MCP.
      }
    }
    return results;
  }

  async findProject(presentationId) {
    const directories = await readdir(this.#root, { withFileTypes: true });
    for (const entry of directories) {
      if (!entry.isDirectory()) continue;
      try {
        const candidate = await realpath(join(this.#root, entry.name));
        assertInside(this.#root, candidate);
        const document = JSON.parse(await readFile(join(candidate, DOCUMENT_FILE), "utf8"));
        assertDeksDocument(document);
        if (document.id === presentationId) return { path: candidate, document };
      } catch {
        // Ignore folders that are not valid DEKS projects.
      }
    }
    throw new Error("presentation_not_found");
  }

  async getPresentation(presentationId) {
    return (await this.findProject(presentationId)).document;
  }

  /**
   * Bytes de los assets embebidos, por identidad. Un asset ilegible se omite en
   * vez de tumbar el render: la slide se ve con su placeholder y el informe lo
   * dice, que es más útil que no ver nada.
   */
  async readAssets(presentationId) {
    const project = await this.findProject(presentationId);
    const assets = {};
    for (const asset of project.document.assets ?? []) {
      if (asset.kind !== "embedded") continue;
      const extension = assetExtension(asset.mediaType);
      if (!extension) continue;
      const file = join(project.path, ASSETS_DIR, `${asset.id}.${extension}`);
      try {
        assertInside(project.path, file);
        assets[asset.id] = { mediaType: asset.mediaType, base64: (await readFile(file)).toString("base64") };
      } catch {
        // Sin bytes el elemento queda como no resuelto, igual que antes.
      }
    }
    return assets;
  }

  /**
   * Registra bytes que trae el agente como asset del proyecto y lo declara en
   * el documento. No acepta rutas: MCP sólo ve la raíz autorizada, así que
   * pedirle un archivo del disco sería darle un lector de archivos arbitrario.
   */
  async addAsset({ presentationId, expectedRevision, idempotencyKey, base64, originalFilename }) {
    if (typeof base64 !== "string" || base64.length === 0) throw new Error("asset_required");
    let bytes;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      throw new Error("asset_not_base64");
    }
    if (bytes.length === 0) throw new Error("asset_empty");
    if (bytes.length > MAX_ASSET_BYTES) throw new Error("asset_too_large");
    const signature = sniffAsset(bytes);
    if (!signature) throw new Error("asset_media_type_unsupported");

    const project = await this.findProject(presentationId);
    const assetId = `asset-${randomUUID().replaceAll("-", "")}`;
    await mkdir(join(project.path, ASSETS_DIR), { recursive: true });
    const destination = join(project.path, ASSETS_DIR, `${assetId}.${signature.extension}`);
    assertInside(project.path, destination);

    // Los bytes primero: un descriptor que apunte a un archivo ausente dejaría
    // la presentación rota para quien la abra después.
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);

    const asset = {
      id: assetId,
      kind: "embedded",
      mediaType: signature.mediaType,
      ...(typeof originalFilename === "string" && originalFilename.length > 0
        ? { originalFilename: originalFilename.slice(0, 200) }
        : {}),
    };
    try {
      const result = await this.applyCommands({
        presentationId,
        expectedRevision,
        idempotencyKey,
        commands: [{ type: "define-asset", asset }],
      });
      return { ...result, asset };
    } catch (error) {
      // El documento no aceptó el descriptor: los bytes huérfanos se retiran en
      // vez de quedar ocupando la carpeta del proyecto para siempre.
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  }

  async applyCommands({ presentationId, expectedRevision, idempotencyKey, commands }) {
    if (!Array.isArray(commands) || commands.length === 0) throw new Error("commands_required");
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new Error("invalid_idempotency_key");
    }
    const project = await this.findProject(presentationId);
    await mkdir(join(project.path, "changes"), { recursive: true });
    const receiptName = `idempotency-${createHash("sha256").update(idempotencyKey).digest("hex")}.json`;
    const receiptPath = join(project.path, "changes", receiptName);
    const requestHash = createHash("sha256").update(JSON.stringify({ presentationId, commands })).digest("hex");
    const prior = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => undefined);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error("idempotency_key_reused");
      return prior.result;
    }

    const release = await acquireLock(project.path);
    try {
      const concurrentPrior = await readFile(receiptPath, "utf8").then(JSON.parse).catch(() => undefined);
      if (concurrentPrior) {
        if (concurrentPrior.requestHash !== requestHash) throw new Error("idempotency_key_reused");
        return concurrentPrior.result;
      }
      const current = JSON.parse(await readFile(join(project.path, DOCUMENT_FILE), "utf8"));
      assertDeksDocument(current);
      if (current.revision !== expectedRevision) throw new Error("revision_conflict");

      let next = current;
      for (const command of commands) {
        if (!command || typeof command !== "object" || !DEKS_COMMAND_TYPE_SET.has(command.type)) {
          throw new Error("unsupported_command");
        }
        // `applyDeksCommand` devuelve `{ document, changeSet }` en el contrato
        // canónico: el documento es una propiedad del resultado, no el resultado.
        next = applyDeksCommand(next, command).document;
      }
      next = { ...next, revision: expectedRevision + 1 };
      assertDeksDocument(next);
      const changed = touchedIds(commands);
      const result = {
        presentationId,
        revision: next.revision,
        changedSlideIds: changed.slideIds,
        changedElementIds: changed.elementIds,
        document: next,
      };
      await atomicWrite(join(project.path, DOCUMENT_FILE), next);
      await atomicWrite(join(project.path, "changes", `${next.revision}.json`), {
        path: project.path,
        revision: next.revision,
        origin: "agent",
        changedSlideIds: changed.slideIds,
        changedElementIds: changed.elementIds,
      });
      await atomicWrite(receiptPath, { presentationId, requestHash, result });
      return result;
    } finally {
      await release();
    }
  }
}
