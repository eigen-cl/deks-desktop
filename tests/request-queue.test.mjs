import assert from "node:assert/strict";
import test from "node:test";
import { RequestQueue } from "../mcp/request-queue.mjs";

test("shutdown waits for an active render before closing its browser", async () => {
  const events = [];
  let finishRender;
  const renderGate = new Promise((resolve) => { finishRender = resolve; });
  const queue = new RequestQueue();
  queue.enqueue(async () => {
    events.push("render-started");
    await renderGate;
    events.push("render-finished");
  });
  const closed = queue.close(async () => { events.push("browser-closed"); });

  await Promise.resolve();
  assert.deepEqual(events, ["render-started"]);
  finishRender();
  await closed;
  assert.deepEqual(events, ["render-started", "render-finished", "browser-closed"]);
});
