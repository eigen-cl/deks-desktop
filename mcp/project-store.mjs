import { createHash, randomUUID } from "node:crypto";
import { constants, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { applyDeksCommand, assertDeksDocument } from "@deks-js/document";

const DOCUMENT_FILE = "document.deks.json";
const LOCK_FILE = "project.lock";
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
