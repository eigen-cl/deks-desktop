import { DEKS_COMMAND_TYPES } from "./project-store.mjs";

const READ_ONLY = Object.freeze({
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
});

export const MCP_TOOLS = Object.freeze([
  {
    name: "list_presentations",
    description: "List valid local DEKS presentations inside the explicitly authorized root.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: READ_ONLY,
  },
  {
    name: "get_presentation",
    description: "Read the canonical local DEKS document and its current revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["presentation_id"],
      properties: { presentation_id: { type: "string", minLength: 1 } },
    },
    annotations: READ_ONLY,
  },
  {
    name: "render_slide_preview",
    description: "Render one slide with DEKS Core in isolated Chromium and return PNG, DOM measurements and visual QA issues.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["presentation_id", "slide_id"],
      properties: {
        presentation_id: { type: "string", minLength: 1 },
        slide_id: { type: "string", minLength: 1 },
        expected_revision: { type: "integer", minimum: 0 },
        width: { type: "integer", enum: [1280, 1600], default: 1600 },
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: "apply_commands",
    description: "Apply a validated batch of DEKS Core commands as one local revision.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["presentation_id", "expected_revision", "idempotency_key", "commands"],
      properties: {
        presentation_id: { type: "string", minLength: 1 },
        expected_revision: { type: "integer", minimum: 0 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
        commands: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            required: ["type"],
            properties: { type: { enum: DEKS_COMMAND_TYPES } },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
]);

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export class McpToolRuntime {
  constructor({ store, visualQa }) {
    this.store = store;
    this.visualQa = visualQa;
  }

  async call(name, args = {}) {
    if (name === "list_presentations") return textResult(await this.store.listPresentations());
    if (name === "get_presentation") {
      return textResult(await this.store.getPresentation(args.presentation_id));
    }
    if (name === "render_slide_preview") {
      const { png, report } = await this.visualQa.renderSlide({
        presentationId: args.presentation_id,
        slideId: args.slide_id,
        width: args.width ?? 1600,
        expectedRevision: args.expected_revision,
      });
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify(report) },
        ],
        structuredContent: report,
      };
    }
    if (name === "apply_commands") {
      return textResult(await this.store.applyCommands({
        presentationId: args.presentation_id,
        expectedRevision: args.expected_revision,
        idempotencyKey: args.idempotency_key,
        commands: args.commands,
      }));
    }
    throw new Error("tool_not_found");
  }
}
