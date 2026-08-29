import { describe, expect, it } from "vitest";
import { assertDeksDocument } from "@deks-js/document";
import {
  canonicalId,
  isLegacyDocument,
  toCanonicalDocument,
  toCanonicalDocumentResult,
} from "../src/legacy-document";
import { createPresentation } from "../src/model";

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
    expect(document.elements[0]).toMatchObject({
      kind: "text", name: "Título", isLocked: false,
      content: "Hola", fontFamily: "Poppins",
      horizontalAlignment: "left", verticalAlignment: "top", overflowMode: "hidden",
    });
    expect(document.elements[0]).not.toHaveProperty("x");
    expect(document.slides[0]?.states[0]).toMatchObject({ x: 100, y: 120, fontSize: 64 });
    expect(document.slides[0]?.states[0]).not.toHaveProperty("content");
    expect(document.slides[0]).not.toHaveProperty("elements");
  });

  it("migra v1 sin bloquear, elige la primera slide y describe cada conflicto", () => {
    const first = structuredClone(legacy.slides[0]);
    const second = structuredClone(first);
    second.id = "presentation-1:slide:dos";
    second.elements[0]!.content = "Otro título";
    second.elements[0]!.horizontalAlignment = "right";

    const result = toCanonicalDocumentResult({ ...legacy, slides: [first, second] });

    expect(result.fromVersion).toBe(1);
    expect(result.document.codecVersion).toBe(3);
    expect(result.document.elements[0]).toMatchObject({
      content: "Hola",
      horizontalAlignment: "left",
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "text-identity-conflict",
        elementId: "presentation-1.element.titulo",
        field: "content",
        chosenSlideId: "presentation-1.slide.uno",
        ignored: [expect.objectContaining({ slideId: "presentation-1.slide.dos" })],
      }),
      expect.objectContaining({ field: "horizontalAlignment" }),
    ]));
  });

  it("reescribe los IDs que la gramática canónica ya no acepta", () => {
    const document = toCanonicalDocument(legacy);

    // El formato antiguo namespaceaba con `:`, que 1.0 rechaza.
    expect(canonicalId("presentation-1:slide:uno")).toBe("presentation-1.slide.uno");
    expect(document.slides[0]?.id).not.toMatch(/:/);
    expect(document.slides[0]?.states[0]?.elementId).toBe(document.elements[0]?.id);
  });

  it("reescribe parentId junto con la identidad al migrar grupos antiguos", () => {
    const grouped: any = structuredClone(legacy);
    grouped.slides[0]!.elements = [
      {
        id: "presentation-1:group:hero", kind: "group", name: "Hero", isLocked: false,
        x: 0, y: 0, width: 1, height: 1, rotationDeg: 0, opacity: 1, zIndex: 0,
      },
      {
        id: "presentation-1:element:card", kind: "shape", shapeKind: "rectangle",
        name: "Card", parentId: "presentation-1:group:hero", isLocked: false,
        x: 100, y: 120, width: 800, height: 200, rotationDeg: 0, opacity: 1, zIndex: 1,
        shapeFill: { kind: "solid", color: "#ff7043" }, stroke: "#ff7043", strokeWidth: 0,
      },
    ];

    const document = toCanonicalDocument(grouped);

    expect(document.elements.find(({ id }) => id.endsWith("element.card"))?.parentId)
      .toBe("presentation-1.group.hero");
    expect(() => assertDeksDocument(document)).not.toThrow();
  });

  it("no vuelve a migrar un documento que ya es canónico", () => {
    const canonical = toCanonicalDocument(legacy);

    expect(toCanonicalDocument(canonical)).toEqual(canonical);
  });
});

describe("un documento canónico anterior al contrato vigente", () => {
  /** Lo que Desktop 0.6.0 escribía: canónico, pero sin la espera en beats. */
  function writtenBeforeDelayBeats() {
    const document = JSON.parse(JSON.stringify(createPresentation("Deck", { width: 1600, height: 900 }, "deck"))) as Record<string, any>;
    for (const role of ["in", "out", "morph"]) delete document.motion[role].delayBeats;
    return document;
  }

  it("completa la propiedad que le falta en vez de rechazar el archivo", () => {
    const older = writtenBeforeDelayBeats();
    expect(() => assertDeksDocument(older)).toThrow(/delayBeats/);

    const opened = toCanonicalDocument(older);
    expect(() => assertDeksDocument(opened)).not.toThrow();
    // Hereda del contrato vigente, que es lo que la raíz debe declarar entera.
    expect(opened.motion.in.delayBeats).toBe(0);
    expect(opened.motion.morph.delayBeats).toBe(0);
  });

  it("no toca lo que el documento sí declara", () => {
    const older = writtenBeforeDelayBeats();
    older.motion.in.durationBeats = 2.5;
    older.motion.in.easing = "linear";
    older.motion.out.delayMs = 320;

    const opened = toCanonicalDocument(older);
    expect(opened.motion.in.durationBeats).toBe(2.5);
    expect(opened.motion.in.easing).toBe("linear");
    expect(opened.motion.out.delayMs).toBe(320);
  });

  it("deja intacto un documento que ya está completo", () => {
    const current = createPresentation("Deck", { width: 1600, height: 900 }, "deck");
    expect(toCanonicalDocument(current)).toEqual(current);
  });

  it("rechaza una versión futura en vez de degradarla", () => {
    const future = { ...createPresentation("Future"), codecVersion: 99 };
    expect(() => toCanonicalDocument(future)).toThrow(/future codecVersion 99/);
  });
});
