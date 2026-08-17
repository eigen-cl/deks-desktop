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
    || rect.x + rect.width > document.canvas.width
    || rect.y + rect.height > document.canvas.height;
}

function prepareDocument(document, slideId, resolved = {}) {
  const slide = document.slides.find(({ id }) => id === slideId);
  if (!slide) throw new Error("slide_not_found");
  const unresolvedAssets = [];
  const previewDocument = structuredClone(document);
  const previewSlide = previewDocument.slides.find(({ id }) => id === slideId);
  // El contrato canónico separa identidad de checkpoint: el tipo del elemento
  // vive en `document.elements` y su geometría en `slide.states`.
  const identities = new Map(previewDocument.elements.map((element) => [element.id, element]));
  previewSlide.states = previewSlide.states.flatMap((state) => {
    const identity = identities.get(state.elementId);
    if (identity?.kind !== "image" || !state.assetId) return state;
    // Con bytes disponibles la imagen se renderiza como cualquier otro
    // elemento; sólo se omite la que de verdad no se pudo resolver.
    if (resolved[state.assetId]) return state;
    unresolvedAssets.push({
      code: "asset_unresolved",
      severity: "warning",
      slide_id: slideId,
      element_ids: [state.elementId],
      bounds: { x: state.x, y: state.y, width: state.width, height: state.height },
      asset_id: state.assetId ?? null,
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
    const resolvedAssets = await this.store.readAssets?.(presentationId) ?? {};
    const { previewDocument, unresolvedAssets } = prepareDocument(document, slideId, resolvedAssets);
    let result;
    try {
      result = await this.renderer.render({
        // `render-preview` 1.0 recibe el documento canónico directamente: ya no
        // existe un formato intermedio que degradar antes de renderizar.
        document: previewDocument,
        slideId,
        width,
        assets: resolvedAssets,
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
        canvas: { ...document.canvas },
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
