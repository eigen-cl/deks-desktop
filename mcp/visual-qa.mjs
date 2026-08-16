import { toDeksV1Document } from "@deks-js/document";
import { PreviewRenderer, previewSha256 } from "@deks-js/render-preview";

const PREVIEW_WIDTHS = new Set([1280, 1600]);

function serializeMeasurement(measurement) {
  return {
    element_id: measurement.elementId,
    rect: measurement.rect,
    visual_aabb: measurement.visualAabb,
    ...(measurement.contentRect ? { content_rect: measurement.contentRect } : {}),
    ...(measurement.overflowStatus ? { overflow_status: measurement.overflowStatus } : {}),
    measurement_source: "dom",
  };
}

function isOutsideCanvas(rect, document) {
  return rect.x < 0 || rect.y < 0
    || rect.x + rect.width > document.canvasWidth
    || rect.y + rect.height > document.canvasHeight;
}

function prepareDocument(document, slideId) {
  const slide = document.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error("slide_not_found");
  const unresolvedAssets = [];
  const previewDocument = structuredClone(document);
  const previewSlide = previewDocument.slides.find(({ id }) => id === slideId);
  previewSlide.elements = previewSlide.elements.flatMap((element) => {
    if (element.kind !== "image" || (!element.assetId && !element.assetUrl && !element.src)) return element;
    unresolvedAssets.push({
      code: "asset_unresolved",
      severity: "warning",
      slide_id: slideId,
      element_ids: [element.id],
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      asset_id: element.assetId ?? null,
      message: "Desktop preview did not receive safe raster bytes for this image; it was omitted.",
    });
    return [];
  });
  return { previewDocument, unresolvedAssets };
}

export class VisualQaService {
  constructor({ store, renderer = new PreviewRenderer() }) {
    this.store = store;
    this.renderer = renderer;
  }

  async renderSlide({ presentationId, slideId, width = 1600, expectedRevision }) {
    if (!PREVIEW_WIDTHS.has(width)) throw new Error("invalid_preview_width");
    const document = await this.store.getPresentation(presentationId);
    if (expectedRevision !== undefined && document.revision !== expectedRevision) {
      throw new Error("stale_revision");
    }
    const slideIndex = document.slides.findIndex(({ id }) => id === slideId);
    if (slideIndex < 0) throw new Error("slide_not_found");
    const slide = document.slides[slideIndex];
    const { previewDocument, unresolvedAssets } = prepareDocument(document, slideId);
    let result;
    try {
      result = await this.renderer.render({
        document: toDeksV1Document(previewDocument),
        slideId,
        width,
        assets: {},
      });
    } catch {
      throw new Error("render_failed");
    }
    const measurements = result.measurements.map(serializeMeasurement);
    const issues = [...unresolvedAssets];
    for (const measurement of measurements) {
      if (measurement.overflow_status === "overflow") {
        issues.push({
          code: "text_overflow",
          severity: "error",
          slide_id: slideId,
          element_ids: [measurement.element_id],
          bounds: measurement.content_rect ?? measurement.rect,
          message: "Rendered text exceeds its element bounds.",
        });
      }
      if (isOutsideCanvas(measurement.visual_aabb, document)) {
        issues.push({
          code: "outside_canvas",
          severity: "error",
          slide_id: slideId,
          element_ids: [measurement.element_id],
          bounds: measurement.visual_aabb,
          message: "Rendered element extends outside the canonical canvas.",
        });
      }
    }
    return {
      png: result.png,
      report: {
        presentation_id: document.id,
        revision: document.revision,
        slide_id: slideId,
        slide_index: slideIndex,
        slide_name: slide.name,
        canvas: { width: document.canvasWidth, height: document.canvasHeight },
        render: { width: result.width, height: result.height, device_scale_factor: 1 },
        byte_size: result.png.byteLength,
        sha256: previewSha256(result.png),
        missing_assets: unresolvedAssets.map((issue) => ({
          element_id: issue.element_ids[0], asset_id: issue.asset_id,
        })),
        issues,
        layout_measurements: measurements,
      },
    };
  }

  async close() {
    await this.renderer.close();
  }
}
