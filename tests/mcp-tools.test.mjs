import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TOOLS, McpToolRuntime } from "../mcp/tools.mjs";

test("render_slide_preview is a bounded read-only MCP tool without filesystem paths", () => {
  const tool = MCP_TOOLS.find(({ name }) => name === "render_slide_preview");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  });
  assert.deepEqual(tool.inputSchema.required, ["presentation_id", "slide_id"]);
  assert.deepEqual(tool.inputSchema.properties.width.enum, [1280, 1600]);
  assert.deepEqual(tool.inputSchema.properties.expected_revision, { type: "integer", minimum: 0 });
  assert.equal("path" in tool.inputSchema.properties, false);
  assert.equal("command" in tool.inputSchema.properties, false);
});

test("MCP returns PNG content and a machine-readable QA report without base64 duplication", async () => {
  const report = {
    presentation_id: "presentation-1", revision: 3, slide_id: "slide-1",
    width: 1280, height: 720, byte_size: 9, sha256: "abc", issues: [],
    layout_measurements: [],
  };
  const runtime = new McpToolRuntime({
    store: {
      async listPresentations() { return []; },
      async getPresentation() { return {}; },
      async applyCommands() { return {}; },
    },
    visualQa: {
      async renderSlide(input) {
        assert.deepEqual(input, {
          presentationId: "presentation-1", slideId: "slide-1", width: 1280,
          expectedRevision: 3,
        });
        return { png: Buffer.from("png-bytes"), report };
      },
    },
  });

  const result = await runtime.call("render_slide_preview", {
    presentation_id: "presentation-1", slide_id: "slide-1", width: 1280,
    expected_revision: 3,
  });

  assert.deepEqual(result.content[0], {
    type: "image", data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png",
  });
  assert.deepEqual(JSON.parse(result.content[1].text), report);
  assert.deepEqual(result.structuredContent, report);
  assert.equal(result.content[1].text.includes(result.content[0].data), false);
});

test("add_asset takes bytes, never a filesystem path", () => {
  const tool = MCP_TOOLS.find(({ name }) => name === "add_asset");
  assert.ok(tool);
  // MCP sólo ve la raíz autorizada. Aceptar una ruta convertiría esta
  // herramienta en un lector de archivos arbitrario del equipo.
  assert.equal("path" in tool.inputSchema.properties, false);
  assert.equal("source_path" in tool.inputSchema.properties, false);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.inputSchema.required, ["presentation_id", "expected_revision", "idempotency_key", "base64"]);
  // El tipo lo deciden los bytes: no hay `media_type` que un agente pueda mentir.
  assert.equal("media_type" in tool.inputSchema.properties, false);
  assert.equal(tool.annotations.readOnlyHint, false);
});

test("add_asset reaches the store with the caller's revision and idempotency key", async () => {
  const calls = [];
  const runtime = new McpToolRuntime({
    store: { addAsset: async (args) => { calls.push(args); return { revision: 4 }; } },
    visualQa: {},
  });

  await runtime.call("add_asset", {
    presentation_id: "presentation-1",
    expected_revision: 3,
    idempotency_key: "agent-key-0001",
    base64: "AAAA",
    original_filename: "diagram.png",
  });

  assert.deepEqual(calls, [{
    presentationId: "presentation-1",
    expectedRevision: 3,
    idempotencyKey: "agent-key-0001",
    base64: "AAAA",
    originalFilename: "diagram.png",
  }]);
});
