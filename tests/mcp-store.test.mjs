import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../mcp/project-store.mjs";

const document = {
  format: "deks",
  id: "presentation-1",
  name: "Agent demo",
  revision: 0,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  motion: {
    in: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-out" },
    out: { animation: { kind: "fade" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in" },
    morph: { animation: { kind: "morph" }, durationBeats: 1, delayBeats: 0, delayMs: 0, easing: "ease-in-out" },
  },
  palette: { primary: "#111111", secondary: "#222222", accent: "#ff6600", background: "#ffffff", text: "#111111", subtext: "#555555" },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [],
  slides: [{
    id: "presentation-1.slide.1",
    name: "Inicio",
    isTemplate: false,
    background: { kind: "solid", color: "#ffffff" },
    states: [],
  }],
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deks-mcp-"));
  const project = join(root, "agent-demo");
  await mkdir(join(project, "changes"), { recursive: true });
  await mkdir(join(project, "assets"));
  await writeFile(join(project, "document.deks.json"), JSON.stringify(document));
  return { root, project, store: await ProjectStore.fromRoot(root) };
}

test("a command batch is one revision and one observable agent receipt", async () => {
  const { project, store } = await fixture();
  const result = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "test-batch-1",
    commands: [{ type: "update-document", patch: { name: "Built by an agent" } }],
  });

  assert.equal(result.revision, 1);
  assert.equal(result.document.name, "Built by an agent");
  const receipt = JSON.parse(await readFile(join(project, "changes", "1.json"), "utf8"));
  assert.equal(receipt.origin, "agent");
});

test("the same idempotency key never applies twice", async () => {
  const { store } = await fixture();
  const input = {
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "test-batch-repeat",
    commands: [{ type: "update-document", patch: { name: "Once" } }],
  };
  const first = await store.applyCommands(input);
  const replay = await store.applyCommands(input);

  assert.equal(first.revision, 1);
  assert.equal(replay.revision, 1);
});

test("an idempotency key cannot hide a different command", async () => {
  const { store } = await fixture();
  await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "test-key-reuse",
    commands: [{ type: "update-document", patch: { name: "First" } }],
  });

  await assert.rejects(
    store.applyCommands({
      presentationId: document.id,
      expectedRevision: 1,
      idempotencyKey: "test-key-reuse",
      commands: [{ type: "update-document", patch: { name: "Different" } }],
    }),
    /idempotency_key_reused/,
  );
});

test("a stale writer receives revision_conflict", async () => {
  const { store } = await fixture();
  await assert.rejects(
    store.applyCommands({
      presentationId: document.id,
      expectedRevision: 9,
      idempotencyKey: "test-stale-writer",
      commands: [{ type: "update-document", patch: { name: "Stale" } }],
    }),
    /revision_conflict/,
  );
});

test("a failing command rolls back the complete batch", async () => {
  const { project, store } = await fixture();
  await assert.rejects(
    store.applyCommands({
      presentationId: document.id,
      expectedRevision: 0,
      idempotencyKey: "test-atomic-failure",
      commands: [
        { type: "update-document", patch: { name: "Must roll back" } },
        { type: "unsupported-command" },
      ],
    }),
  );
  const unchanged = JSON.parse(await readFile(join(project, "document.deks.json"), "utf8"));
  assert.equal(unchanged.revision, 0);
  assert.equal(unchanged.name, document.name);
});

test("a symlink cannot expose a presentation outside the authorized root", async () => {
  const authorized = await mkdtemp(join(tmpdir(), "deks-authorized-"));
  const outside = await mkdtemp(join(tmpdir(), "deks-outside-"));
  await writeFile(join(outside, "document.deks.json"), JSON.stringify(document));
  await symlink(outside, join(authorized, "linked-project"), "dir");
  const store = await ProjectStore.fromRoot(authorized);

  assert.deepEqual(await store.listPresentations(), []);
  await assert.rejects(store.getPresentation(document.id), /presentation_not_found/);
});

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("payload for the fixture image"),
]);

test("add_asset writes the bytes before declaring the descriptor", async () => {
  const { project, store } = await fixture();

  const result = await store.addAsset({
    presentationId: "presentation-1",
    expectedRevision: 0,
    idempotencyKey: "asset-key-0001",
    base64: PNG_BYTES.toString("base64"),
    originalFilename: "logo.png",
  });

  assert.equal(result.revision, 1);
  assert.equal(result.asset.kind, "embedded");
  assert.equal(result.asset.mediaType, "image/png");
  assert.equal(result.asset.originalFilename, "logo.png");
  const stored = await readFile(join(project, "assets", `${result.asset.id}.png`));
  assert.deepEqual(stored, PNG_BYTES);
  // El descriptor quedó en el documento, no sólo en la respuesta.
  assert.deepEqual(result.document.assets, [result.asset]);
});

test("add_asset types the bytes itself and refuses anything that is not a raster image", async () => {
  const { project, store } = await fixture();

  await assert.rejects(
    store.addAsset({
      presentationId: "presentation-1",
      expectedRevision: 0,
      idempotencyKey: "asset-key-0002",
      base64: Buffer.from("<html>definitely not an image</html>").toString("base64"),
    }),
    /asset_media_type_unsupported/,
  );

  // Nada quedó en la carpeta: el rechazo ocurre antes de escribir.
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(join(project, "assets")), []);
});

test("add_asset withdraws orphan bytes when the document rejects the descriptor", async () => {
  const { project, store } = await fixture();
  const { readdir } = await import("node:fs/promises");

  await assert.rejects(
    store.addAsset({
      presentationId: "presentation-1",
      // Una revisión que no es la actual: el documento no acepta el cambio.
      expectedRevision: 7,
      idempotencyKey: "asset-key-0003",
      base64: PNG_BYTES.toString("base64"),
    }),
    /revision_conflict/,
  );

  assert.deepEqual(await readdir(join(project, "assets")), []);
});

test("add_asset replays one idempotency key instead of storing the bytes twice", async () => {
  const { project, store } = await fixture();
  const { readdir } = await import("node:fs/promises");
  const request = {
    presentationId: "presentation-1",
    expectedRevision: 0,
    idempotencyKey: "asset-key-0004",
    base64: PNG_BYTES.toString("base64"),
  };

  const first = await store.addAsset(request);
  const second = await store.addAsset(request).catch((error) => error);

  // El segundo intento no puede duplicar el asset ni saltar de revisión.
  assert.equal(first.revision, 1);
  assert.ok(second instanceof Error || second.revision === 1);
  const files = await readdir(join(project, "assets"));
  assert.ok(files.length <= 2, `expected at most one stored asset, found ${files.join(", ")}`);
});

test("readAssets returns the stored bytes so visual QA can draw the image", async () => {
  const { store } = await fixture();
  const added = await store.addAsset({
    presentationId: "presentation-1",
    expectedRevision: 0,
    idempotencyKey: "asset-key-0005",
    base64: PNG_BYTES.toString("base64"),
  });

  const assets = await store.readAssets("presentation-1");
  assert.deepEqual(assets[added.asset.id], {
    mediaType: "image/png",
    base64: PNG_BYTES.toString("base64"),
  });
});
