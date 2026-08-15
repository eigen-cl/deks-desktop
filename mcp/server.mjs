#!/usr/bin/env node
import { createInterface } from "node:readline";
import { DEKS_COMMAND_TYPES, ProjectStore } from "./project-store.mjs";

const projectsRoot = process.env.DEKS_PROJECTS_ROOT;
if (!projectsRoot) {
  process.stderr.write("DEKS_PROJECTS_ROOT is required\n");
  process.exit(1);
}

const store = await ProjectStore.fromRoot(projectsRoot);

const tools = [
  {
    name: "list_presentations",
    description: "List valid local DEKS presentations inside the explicitly authorized root.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
];

function response(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

async function callTool(name, args = {}) {
  if (name === "list_presentations") return store.listPresentations();
  if (name === "get_presentation") return store.getPresentation(args.presentation_id);
  if (name === "apply_commands") {
    return store.applyCommands({
      presentationId: args.presentation_id,
      expectedRevision: args.expected_revision,
      idempotencyKey: args.idempotency_key,
      commands: args.commands,
    });
  }
  throw new Error("tool_not_found");
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    error(null, -32700, "Parse error");
    return;
  }
  if (request.method?.startsWith("notifications/")) return;
  try {
    if (request.method === "initialize") {
      response(request.id, {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "deks-local", version: "0.1.0" },
      });
    } else if (request.method === "tools/list") {
      response(request.id, { tools });
    } else if (request.method === "tools/call") {
      const value = await callTool(request.params?.name, request.params?.arguments);
      response(request.id, { content: [{ type: "text", text: JSON.stringify(value) }] });
    } else if (request.method === "ping") {
      response(request.id, {});
    } else {
      error(request.id, -32601, "Method not found");
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "internal_error";
    response(request.id, { isError: true, content: [{ type: "text", text: JSON.stringify({ code: message }) }] });
  }
});
