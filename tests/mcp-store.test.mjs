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
  palette: { primary: "#111111", secondary: "#222222", accent: "#ff6600", background: "#ffffff", text: "#111111", subtext: "#555555" },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [],
  slides: [{
    id: "presentation-1.slide.1",
    name: "Inicio",
    isTemplate: false,
    background: { kind: "solid", color: "#ffffff" },
    inPreset: "fade",
    outPreset: "fade",
    inDurationMultiplier: 1,
    outDurationMultiplier: 1,
    states: [],
  }],
  transitions: [],
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
