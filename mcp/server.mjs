#!/usr/bin/env node
import { createInterface } from "node:readline";
import { ProjectStore } from "./project-store.mjs";
import { RequestQueue } from "./request-queue.mjs";
import { MCP_TOOLS, McpToolRuntime } from "./tools.mjs";
import { VisualQaService } from "./visual-qa.mjs";

const projectsRoot = process.env.DEKS_PROJECTS_ROOT;
if (!projectsRoot) {
  process.stderr.write("DEKS_PROJECTS_ROOT is required\n");
  process.exit(1);
}

const store = await ProjectStore.fromRoot(projectsRoot);
const visualQa = new VisualQaService({ store });
const runtime = new McpToolRuntime({ store, visualQa });

function response(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function error(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const requestQueue = new RequestQueue();

async function handleLine(line) {
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
        serverInfo: { name: "deks-local", version: "0.2.0" },
      });
    } else if (request.method === "tools/list") {
      response(request.id, { tools: MCP_TOOLS });
    } else if (request.method === "tools/call") {
      response(request.id, await runtime.call(request.params?.name, request.params?.arguments));
    } else if (request.method === "ping") {
      response(request.id, {});
    } else {
      error(request.id, -32601, "Method not found");
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "internal_error";
    response(request.id, { isError: true, content: [{ type: "text", text: JSON.stringify({ code: message }) }] });
  }
}

input.on("line", (line) => {
  void requestQueue.enqueue(() => handleLine(line));
});

async function shutdown() {
  input.close();
  await requestQueue.close(() => visualQa.close());
}

process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.stdin.once("end", () => void shutdown());
