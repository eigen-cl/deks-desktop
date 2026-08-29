import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { createDeksFile, readDeksFile } from "@deks-js/document";
import { ProjectStore } from "../mcp/project-store.mjs";

const document = {
  format: "deks",
  codecVersion: 3,
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

function legacyV1Document(input = document) {
  const legacy = structuredClone(input);
  delete legacy.codecVersion;
  return legacy;
}

const PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/6WQzgAAAAABJRU5ErkJggg==", "base64");
const OTHER_PNG_BYTES = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function wavPcm16(sampleCount = 2_400, sampleRate = 24_000) {
  const bytes = Buffer.alloc(44 + sampleCount * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(sampleCount * 2, 40);
  return bytes;
}

function canonicalMp3Frame() {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return frame;
}

const SVG_SOURCE = Buffer.from(`
  <svg height="50px" width="100" xmlns="http://www.w3.org/2000/svg">
    <title>Safe logo</title><path fill="#ff7043" d="M0 0 L100 50 Z"/>
  </svg>
`);
const SVG_CANONICAL = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><title>Safe logo</title><path d="M0 0 L100 50 Z" fill="#ff7043"/></svg>');

async function writeDeks(path, input = document, assets = []) {
  const file = await createDeksFile(structuredClone(input), assets);
  await writeFile(path, file.bytes);
}

async function fixture({ withAsset = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "deks-mcp-"));
  const file = join(root, "agent-demo.deks");
  const input = structuredClone(document);
  const assets = [];
  if (withAsset) {
    input.assets.push({ id: "asset-existing", kind: "embedded", mediaType: "image/png", originalFilename: "existing.png" });
    assets.push({ id: "asset-existing", mediaType: "image/png", bytes: PNG_BYTES });
  }
  await writeDeks(file, input, assets);
  return { root, file, store: await ProjectStore.fromRoot(root) };
}

async function decoded(path) {
  return readDeksFile(await readFile(path));
}

test("DEKS_PROJECTS_ROOT discovers valid direct .deks files", async () => {
  const { root, store } = await fixture();
  await writeFile(join(root, "notes.txt"), "not a presentation");
  await writeFile(join(root, "broken.deks"), "not a zip");

  assert.deepEqual(await store.listPresentations(), [{ id: document.id, name: document.name, revision: 0 }]);
  assert.deepEqual(await store.getPresentation(document.id), document);
});

test("a command batch atomically replaces one .deks file and writes external hidden activity", async () => {
  const { root, file, store } = await fixture();
  const result = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "test-batch-1",
    commands: [{ type: "update-document", patch: { name: "Built by an agent" } }],
  });

  assert.equal(result.revision, 1);
  assert.equal(result.document.name, "Built by an agent");
  assert.equal((await decoded(file)).document.name, "Built by an agent");
  const stateDirectory = join(root, `.${basename(file)}.state`);
  const receipt = JSON.parse(await readFile(join(stateDirectory, "1.json"), "utf8"));
  assert.deepEqual(receipt, {
    presentationId: document.id,
    revision: 1,
    origin: "agent",
    changedSlideIds: [],
    changedElementIds: [],
  });
  await assert.rejects(access(join(root, `.${basename(file)}.lock`)));
  assert.equal((await readFile(file)).includes(Buffer.from(root)), false, "the portable archive must not contain a local path");
});

test("apply_commands accepts parentId null as JSON ungroup and omits it from the portable document", async () => {
  const { file, store } = await fixture();
  const grouped = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "group-element-1",
    commands: [
      { type: "define-element", element: { id: "hero", kind: "group", name: "Hero", isLocked: false } },
      {
        type: "define-element",
        element: { id: "title", kind: "shape", shapeKind: "rectangle", name: "Title", parentId: "hero", isLocked: false },
      },
      {
        type: "add-element-state",
        slideId: document.slides[0].id,
        state: {
          elementId: "title", x: 10, y: 10, width: 100, height: 50,
          rotationDeg: 0, opacity: 1, zIndex: 1,
          shapeFill: { kind: "solid", color: "#111111" }, stroke: "#111111", strokeWidth: 0,
        },
      },
    ],
  });
  assert.equal(grouped.document.slides[0].states.some(({ elementId }) => elementId === "hero"), false);

  const ungrouped = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 1,
    idempotencyKey: "ungroup-element-1",
    commands: [{ type: "update-element-identity", elementId: "title", patch: { parentId: null } }],
  });

  assert.equal(Object.hasOwn(ungrouped.document.elements.find(({ id }) => id === "title"), "parentId"), false);
  const reopened = await decoded(file);
  assert.equal(Object.hasOwn(reopened.document.elements.find(({ id }) => id === "title"), "parentId"), false);
});

test("apply_commands preserves every embedded asset while rewriting the manifest", async () => {
  const { file, store } = await fixture({ withAsset: true });
  await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "preserve-assets-1",
    commands: [{ type: "update-document", patch: { name: "Assets survive" } }],
  });
  const reopened = await decoded(file);
  assert.equal(reopened.document.name, "Assets survive");
  assert.equal(reopened.assets.length, 1);
  assert.equal(reopened.assets[0].id, "asset-existing");
  assert.deepEqual(Buffer.from(reopened.assets[0].bytes), PNG_BYTES);
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
  await assert.rejects(store.applyCommands({
    presentationId: document.id,
    expectedRevision: 1,
    idempotencyKey: "test-key-reuse",
    commands: [{ type: "update-document", patch: { name: "Different" } }],
  }), /idempotency_key_reused/);
});

test("a stale writer receives revision_conflict", async () => {
  const { store } = await fixture();
  await assert.rejects(store.applyCommands({
    presentationId: document.id,
    expectedRevision: 9,
    idempotencyKey: "test-stale-writer",
    commands: [{ type: "update-document", patch: { name: "Stale" } }],
  }), /revision_conflict/);
});

test("a failing command leaves the complete .deks archive unchanged", async () => {
  const { file, store } = await fixture();
  const before = await readFile(file);
  await assert.rejects(store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "test-atomic-failure",
    commands: [
      { type: "update-document", patch: { name: "Must roll back" } },
      { type: "unsupported-command" },
    ],
  }));
  assert.deepEqual(await readFile(file), before);
});

test("a symlink cannot expose a .deks file outside the authorized root", async () => {
  const authorized = await mkdtemp(join(tmpdir(), "deks-authorized-"));
  const outside = await mkdtemp(join(tmpdir(), "deks-outside-"));
  const outsideFile = join(outside, "outside.deks");
  await writeDeks(outsideFile);
  await symlink(outsideFile, join(authorized, "linked.deks"), "file");
  const store = await ProjectStore.fromRoot(authorized);
  assert.deepEqual(await store.listPresentations(), []);
  await assert.rejects(store.getPresentation(document.id), /presentation_not_found/);
});

test("a hidden state symlink cannot turn MCP receipts into an arbitrary file writer", async () => {
  const { root, file, store } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "deks-state-outside-"));
  await symlink(outside, join(root, `.${basename(file)}.state`), "dir");

  await assert.rejects(store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "state-symlink-1",
    commands: [{ type: "update-document", patch: { name: "Must not escape" } }],
  }), /path_not_authorized/);
  assert.deepEqual(await readdir(outside), []);
  assert.equal((await decoded(file)).document.revision, 0);
});

test("add_asset embeds bytes inside the same .deks file before declaring the descriptor", async () => {
  const { file, store } = await fixture();
  const result = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-key-0001",
    base64: PNG_BYTES.toString("base64"),
    originalFilename: "logo.png",
  });
  assert.equal(result.revision, 1);
  assert.equal(result.asset.kind, "embedded");
  assert.equal(result.asset.mediaType, "image/png");
  assert.equal(result.asset.originalFilename, "logo.png");
  const reopened = await decoded(file);
  assert.deepEqual(reopened.document.assets, [result.asset]);
  assert.equal(reopened.assets[0].id, result.asset.id);
  assert.deepEqual(Buffer.from(reopened.assets[0].bytes), PNG_BYTES);
});

test("add_asset sniffs portable WAV bytes and apply_commands sets and clears slide narration", async () => {
  const { file, store } = await fixture();
  const wav = wavPcm16();
  const added = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "narration-audio-1",
    base64: wav.toString("base64"),
    originalFilename: "voz.wav",
  });
  assert.equal(added.asset.mediaType, "audio/wav");

  const narrated = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 1,
    idempotencyKey: "narration-set-01",
    commands: [{
      type: "set-slide-narration",
      slideId: document.slides[0].id,
      narration: {
        script: "Presentamos esta diapositiva.",
        pauseBeforeMs: 200,
        pauseAfterMs: 350,
        audio: { assetId: added.asset.id, provenance: "human-recorded" },
      },
    }],
  });
  assert.deepEqual(narrated.document.slides[0].narration.audio, {
    assetId: added.asset.id,
    provenance: "human-recorded",
  });

  const cleared = await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 2,
    idempotencyKey: "narration-clear-1",
    commands: [
      { type: "clear-slide-narration", slideId: document.slides[0].id },
      { type: "remove-asset", assetId: added.asset.id },
    ],
  });
  assert.equal("narration" in cleared.document.slides[0], false);
  assert.equal(cleared.document.assets.length, 0);
  const reopened = await decoded(file);
  assert.equal(reopened.assets.length, 0);
});

test("add_asset also sniffs canonical MPEG-1 Layer III without caller-declared MIME", async () => {
  const { store } = await fixture();
  const added = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "narration-mp3-01",
    base64: canonicalMp3Frame().toString("base64"),
    originalFilename: "voz.bin",
  });
  assert.equal(added.asset.mediaType, "audio/mpeg");
});

test("add_asset types the bytes itself and refuses anything that is not a supported portable asset", async () => {
  const { file, store } = await fixture();
  const before = await readFile(file);
  await assert.rejects(store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-key-0002",
    base64: Buffer.from("<html>definitely not an image</html>").toString("base64"),
  }), /asset_media_type_unsupported/);
  assert.deepEqual(await readFile(file), before);
});

test("add_asset sanitizes SVG before hashing and packages only canonical bytes", async () => {
  const { file, store } = await fixture();
  const result = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-svg-safe-1",
    base64: SVG_SOURCE.toString("base64"),
    originalFilename: "brand.svg",
  });

  assert.equal(result.asset.mediaType, "image/svg+xml");
  const reopened = await decoded(file);
  assert.deepEqual(Buffer.from(reopened.assets[0].bytes), SVG_CANONICAL);
  assert.equal(reopened.document.assets[0].mediaType, "image/svg+xml");
});

test("unsafe SVG rejection is atomic and creates no receipt or activity side effects", async () => {
  const { root, file, store } = await fixture();
  const before = await readFile(file);
  const unsafe = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>');

  await assert.rejects(store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-svg-bad-1",
    base64: unsafe.toString("base64"),
  }), /asset_unsafe/);

  assert.deepEqual(await readFile(file), before);
  await assert.rejects(access(join(root, `.${basename(file)}.state`)));
  await assert.rejects(access(join(root, `.${basename(file)}.lock`)));
});

test("add_asset replays one idempotency key without duplicating bytes", async () => {
  const { file, store } = await fixture();
  const request = {
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-key-0004",
    base64: PNG_BYTES.toString("base64"),
  };
  const first = await store.addAsset(request);
  const second = await store.addAsset(request);
  assert.equal(first.revision, 1);
  assert.deepEqual(second, first);
  const reopened = await decoded(file);
  assert.equal(reopened.document.assets.length, 1);
  assert.equal(reopened.assets.length, 1);
  await assert.rejects(store.addAsset({
    ...request,
    base64: OTHER_PNG_BYTES.toString("base64"),
  }), /idempotency_key_reused/);
});

test("readAssets returns packaged bytes so visual QA can draw the image", async () => {
  const { store } = await fixture();
  const added = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-key-0005",
    base64: PNG_BYTES.toString("base64"),
  });
  const assets = await store.readAssets(document.id);
  assert.deepEqual(assets[added.asset.id], {
    mediaType: "image/png",
    base64: PNG_BYTES.toString("base64"),
  });
});

test("readAssets returns canonical SVG bytes to the preview boundary", async () => {
  const { store } = await fixture();
  const added = await store.addAsset({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "asset-svg-preview-1",
    base64: SVG_SOURCE.toString("base64"),
  });
  const assets = await store.readAssets(document.id);
  assert.deepEqual(assets[added.asset.id], {
    mediaType: "image/svg+xml",
    base64: SVG_CANONICAL.toString("base64"),
  });
});

test("legacy expanded folders remain readable and writable without being deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "deks-mcp-legacy-"));
  const project = join(root, "legacy-project");
  await mkdir(join(project, "changes"), { recursive: true });
  await mkdir(join(project, "assets"));
  await writeFile(join(project, "document.deks.json"), JSON.stringify(legacyV1Document()));
  const store = await ProjectStore.fromRoot(root);
  const migrated = await store.getPresentation(document.id);
  assert.equal(migrated.name, document.name);
  assert.equal(migrated.codecVersion, 3);
  await store.applyCommands({
    presentationId: document.id,
    expectedRevision: 0,
    idempotencyKey: "legacy-folder-1",
    commands: [{ type: "update-document", patch: { name: "Still compatible" } }],
  });
  const persisted = JSON.parse(await readFile(join(project, "document.deks.json"), "utf8"));
  assert.equal(persisted.name, "Still compatible");
  assert.equal(persisted.codecVersion, 3);
  assert.ok((await readdir(root)).includes("legacy-project"));
});

test("a migrated .deks file takes precedence over its preserved legacy folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "deks-mcp-migrated-"));
  const legacy = join(root, "same-deck");
  await mkdir(legacy);
  await writeFile(join(legacy, "document.deks.json"), JSON.stringify(legacyV1Document({ ...document, name: "Legacy copy" })));
  await writeDeks(join(root, "same-deck.deks"), { ...document, name: "Portable copy", revision: 4 });

  const store = await ProjectStore.fromRoot(root);

  assert.deepEqual(await store.listPresentations(), [{ id: document.id, name: "Portable copy", revision: 4 }]);
  assert.equal((await store.getPresentation(document.id)).name, "Portable copy");
  assert.ok((await readdir(root)).includes("same-deck"), "migration never deletes the source folder");
});
