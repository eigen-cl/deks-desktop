import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VisualQaService } from "../mcp/visual-qa.mjs";

const document = {
  format: "deks",
  id: "browser-preview",
  name: "Browser preview",
  revision: 1,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  palette: {
    primary: "#111111", secondary: "#222222", accent: "#ff6600",
    background: "#ffffff", text: "#111111", subtext: "#555555",
  },
  history: { canUndo: false, canRedo: false },
  assets: [],
  elements: [{ id: "headline", kind: "text", name: "Headline", isLocked: false }],
  slides: [{
    id: "slide-1", name: "Rendered", isTemplate: false,
    background: { kind: "solid", color: "#ffffff" },
    inPreset: "fade", outPreset: "fade",
    inDurationMultiplier: 1, outDurationMultiplier: 1,
    states: [{
      elementId: "headline",
      x: 100, y: 100, width: 800, height: 160,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      content: "Rendered by DEKS Core", fontFamily: "Poppins", fontSize: 48,
      fontWeight: 600, lineHeight: 1.2, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "middle",
      overflowMode: "hidden", fill: "#111111",
    }],
  }],
  transitions: [],
};

test("Desktop visual QA produces a real settled PNG and DOM measurements", async () => {
  const service = new VisualQaService({
    store: { async getPresentation() { return document; } },
  });
  try {
    const result = await service.renderSlide({
      presentationId: document.id,
      slideId: "slide-1",
      expectedRevision: 1,
      width: 1280,
    });

    assert.deepEqual([...result.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual(result.report.render, {
      width: 1280, height: 720, device_scale_factor: 1,
    });
    assert.equal(result.report.layout_measurements.length, 1);
    assert.equal(result.report.layout_measurements[0].measurement_source, "dom");
    assert.equal(result.report.issues.length, 0);
  } finally {
    await service.close();
  }
});

test("stdio waits for an in-flight preview before closing Chromium", { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "deks-desktop-mcp-preview-"));
  const project = join(root, "browser-preview");
  await mkdir(join(project, "assets"), { recursive: true });
  await mkdir(join(project, "changes"), { recursive: true });
  await writeFile(join(project, "document.deks.json"), `${JSON.stringify(document)}\n`, "utf8");

  const child = spawn(process.execPath, ["mcp/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DEKS_PROJECTS_ROOT: root },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });

  try {
    child.stdin.end(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "render_slide_preview",
        arguments: {
          presentation_id: document.id,
          slide_id: "slide-1",
          expected_revision: 1,
          width: 1280,
        },
      },
    })}\n`);
    const exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.deepEqual(exit, { code: 0, signal: null }, stderr);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.id, 1);
    assert.equal(result.result.content[0].type, "image");
    assert.equal(result.result.content[0].mimeType, "image/png");
    assert.equal(result.result.structuredContent.slide_id, "slide-1");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
