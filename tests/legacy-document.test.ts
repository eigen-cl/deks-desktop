import { describe, expect, it } from "vitest";
import { assertDeksDocument } from "@deks-js/document";
import { canonicalId, isLegacyDocument, toCanonicalDocument } from "../src/legacy-document";

const legacy = {
  id: "presentation-1",
  name: "Proyecto anterior",
  revision: 7,
  canvasWidth: 1600,
  canvasHeight: 900,
  motionBeatMs: 600,
  palette: {
    primary: "#ff7043", secondary: "#65c18c", accent: "#73a7ff",
    background: "#0b0c0e", text: "#f2f1ec", subtext: "#969da6",
  },
  history: { canUndo: false, canRedo: false },
  slides: [{
    id: "presentation-1:slide:uno",
    name: "Inicio",
    isTemplate: false,
    background: { kind: "solid", color: "#0b0c0e" },
    inPreset: "fade", outPreset: "fade",
    inDurationMultiplier: 1, outDurationMultiplier: 1,
    elements: [{
      id: "presentation-1:element:titulo",
      kind: "text", name: "Título", isLocked: false,
      x: 100, y: 120, width: 800, height: 200,
      rotationDeg: 0, opacity: 1, zIndex: 1,
      content: "Hola", fontFamily: "Poppins", fontSize: 64, fontWeight: 600,
      lineHeight: 1.1, letterSpacing: 0,
      horizontalAlignment: "left", verticalAlignment: "top",
      overflowMode: "hidden", fill: "#f2f1ec",
    }],
  }],
  transitions: [],
};

describe("proyectos anteriores al contrato canónico", () => {
  it("reconoce el formato antiguo y deja pasar el canónico", () => {
    expect(isLegacyDocument(legacy)).toBe(true);
    expect(isLegacyDocument(toCanonicalDocument(legacy))).toBe(false);
  });

  it("separa identidad de checkpoint y conserva la revisión en disco", () => {
    const document = toCanonicalDocument(legacy);

    expect(() => assertDeksDocument(document)).not.toThrow();
    expect(document.revision).toBe(7);
    expect(document.canvas).toEqual({ width: 1600, height: 900 });
    // La identidad vive una vez; la slide sólo guarda su estado.
    expect(document.elements).toHaveLength(1);
    expect(document.elements[0]).toMatchObject({ kind: "text", name: "Título", isLocked: false });
    expect(document.elements[0]).not.toHaveProperty("x");
    expect(document.slides[0]?.states[0]).toMatchObject({ x: 100, y: 120, content: "Hola" });
    expect(document.slides[0]).not.toHaveProperty("elements");
  });

  it("reescribe los IDs que la gramática canónica ya no acepta", () => {
    const document = toCanonicalDocument(legacy);

    // El formato antiguo namespaceaba con `:`, que 1.0 rechaza.
    expect(canonicalId("presentation-1:slide:uno")).toBe("presentation-1.slide.uno");
    expect(document.slides[0]?.id).not.toMatch(/:/);
    expect(document.slides[0]?.states[0]?.elementId).toBe(document.elements[0]?.id);
  });

  it("no vuelve a migrar un documento que ya es canónico", () => {
    const canonical = toCanonicalDocument(legacy);

    expect(toCanonicalDocument(canonical)).toEqual(canonical);
  });
});
