import assert from "node:assert/strict";
import test from "node:test";
import { VisualQaService } from "../mcp/visual-qa.mjs";

const document = {
  format: "deks",
  id: "presentation-1",
  name: "Visual QA",
  revision: 3,
  canvas: { width: 1600, height: 900 },
  motionBeatMs: 600,
  motion: {
    in: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-out" },
    out: { animation: { kind: "fade" }, durationBeats: 1, delayMs: 0, easing: "ease-in" },
    morph: { animation: { kind: "morph" }, durationBeats: 1, delayMs: 0, easing: "ease-in-out" },
  },
  palette: {
    primary: "#111111", secondary: "#222222", accent: "#ff6600",
    background: "#ffffff", text: "#111111", subtext: "#555555",
  },
  history: { canUndo: false, canRedo: false },
  assets: [{ id: "logo-asset", kind: "embedded", mediaType: "image/svg+xml" }],
  elements: [
    { id: "headline", kind: "text", name: "Headline", isLocked: false },
    { id: "logo", kind: "image", name: "Logo", isLocked: false },
  ],
  slides: [{
    id: "slide-1",
    name: "Overview",
    isTemplate: false,
    background: { kind: "solid", color: "#ffffff" },
    states: [{
      elementId: "headline",
      x: 80, y: 80, width: 600, height: 80, rotationDeg: 0, opacity: 1, zIndex: 1,
      content: "A long headline", fontFamily: "Poppins", fontSize: 48,
      fontWeight: 600, lineHeight: 1.1, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "hidden",
      fill: "#111111",
    }, {
      elementId: "logo",
      x: 1420, y: 820, width: 240, height: 120, rotationDeg: 0, opacity: 1, zIndex: 2,
      assetId: "logo-asset", alt: "Logo", fit: "contain",
    }],
  }],
};

test("visual QA renders one authorized presentation without resolving external asset paths", async () => {
  let previewRequest;
  const renderer = {
    async render(request) {
      previewRequest = request;
      return {
        png: Buffer.from("png-bytes"), width: 1280, height: 720,
        measurements: [{
          elementId: "headline",
          rect: { x: 80, y: 80, width: 600, height: 80 },
          visualAabb: { x: 80, y: 80, width: 600, height: 80 },
          contentRect: { x: 80, y: 80, width: 620, height: 96 },
          overflowStatus: "overflow",
          sources: { rect: "exact", visualAabb: "calculated", contentRect: "dom" },
        }],
      };
    },
    async close() {},
  };
  const store = { async getPresentation(id) { assert.equal(id, document.id); return document; } };
  const service = new VisualQaService({ store, renderer });

  const result = await service.renderSlide({
    presentationId: document.id, slideId: "slide-1", width: 1280, expectedRevision: 3,
  });

  assert.equal(previewRequest.slideId, "slide-1");
  assert.equal(previewRequest.width, 1280);
  assert.deepEqual(previewRequest.assets, {});
  // La imagen sin bytes resueltos se omite del checkpoint enviado al renderer;
  // la identidad sigue en el documento, que es donde vive.
  assert.deepEqual(
    previewRequest.document.slides[0].states.map(({ elementId }) => elementId),
    ["headline"],
  );
  assert.equal(result.png.toString(), "png-bytes");
  assert.deepEqual(result.report.issues.map(({ code, element_ids: elementIds }) => [code, elementIds]), [
    ["asset_unresolved", ["logo"]],
    ["text_overflow", ["headline"]],
  ]);
  assert.equal(result.report.slide_index, 0);
  assert.equal(result.report.slide_name, "Overview");
  assert.deepEqual(result.report.canvas, { width: 1600, height: 900 });
  assert.deepEqual(result.report.render, { width: 1280, height: 720, device_scale_factor: 1 });
  assert.equal(result.report.layout_measurements[0].measurement_source, "dom");
});

test("visual QA rejects a stale expected revision before rendering", async () => {
  let rendered = false;
  const service = new VisualQaService({
    store: { async getPresentation() { return document; } },
    renderer: {
      async render() { rendered = true; throw new Error("must not render"); },
      async close() {},
    },
  });

  await assert.rejects(service.renderSlide({
    presentationId: document.id, slideId: "slide-1", width: 1600, expectedRevision: 2,
  }), /stale_revision/);
  assert.equal(rendered, false);
});

test("visual QA normalizes renderer failures without exposing host paths", async () => {
  const service = new VisualQaService({
    store: { async getPresentation() { return document; } },
    renderer: {
      async render() { throw new Error("ENOENT: /private/runtime/chromium"); },
      async close() {},
    },
  });

  await assert.rejects(
    service.renderSlide({
      presentationId: document.id, slideId: "slide-1", width: 1600, expectedRevision: 3,
    }),
    (error) => error instanceof Error && error.message === "render_failed",
  );
});

test("visual QA delegates browser lifecycle cleanup", async () => {
  let closed = false;
  const service = new VisualQaService({
    store: { async getPresentation() { return document; } },
    renderer: { async render() { throw new Error("unused"); }, async close() { closed = true; } },
  });

  await service.close();
  assert.equal(closed, true);
});

test("visual QA renders an image whose bytes exist and only warns about the ones missing", async () => {
  const document = {
    format: "deks", id: "p1", name: "Deck", revision: 3,
    canvas: { width: 1600, height: 900 }, motionBeatMs: 600,
    palette: { primary: "#111111", secondary: "#222222", accent: "#ff6600", background: "#ffffff", text: "#111111", subtext: "#555555" },
    history: { canUndo: false, canRedo: false },
    assets: [
      { id: "asset-ok", kind: "embedded", mediaType: "image/png" },
      { id: "asset-gone", kind: "embedded", mediaType: "image/png" },
    ],
    elements: [
      { id: "shown", kind: "image", name: "Shown", isLocked: false },
      { id: "missing", kind: "image", name: "Missing", isLocked: false },
    ],
    slides: [{
      id: "s1", name: "One", isTemplate: false,
      background: { kind: "solid", color: "#ffffff" },
      states: [
        { elementId: "shown", x: 0, y: 0, width: 100, height: 100, rotationDeg: 0, opacity: 1, zIndex: 1, assetId: "asset-ok", alt: "ok", fit: "contain" },
        { elementId: "missing", x: 0, y: 0, width: 100, height: 100, rotationDeg: 0, opacity: 1, zIndex: 2, assetId: "asset-gone", alt: "gone", fit: "contain" },
      ],
    }],
  };

  let received;
  const service = new VisualQaService({
    store: {
      getPresentation: async () => document,
      readAssets: async () => ({ "asset-ok": { mediaType: "image/png", base64: "AAAA" } }),
    },
    renderer: {
      render: async (request) => {
        received = request;
        return { png: Buffer.from("png"), measurements: [], width: 1600, height: 900 };
      },
    },
  });

  const { report } = await service.renderSlide({ presentationId: "p1", slideId: "s1" });

  // El asset resuelto llega al renderer y su elemento sobrevive en la slide.
  assert.deepEqual(Object.keys(received.assets), ["asset-ok"]);
  assert.deepEqual(received.document.slides[0].states.map((state) => state.elementId), ["shown"]);
  const unresolved = report.issues.filter((issue) => issue.code === "asset_unresolved");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].asset_id, "asset-gone");
});
