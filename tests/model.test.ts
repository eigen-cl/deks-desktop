import { describe, expect, it } from "vitest";
import { assertDeksDocument } from "@deks-js/document";
import { backgroundCss, createPresentation } from "../src/model";

describe("createPresentation", () => {
  it("construye un documento canónico con el builder oficial", () => {
    const presentation = createPresentation("Automatizable", { width: 1600, height: 900 }, "presentation-1");

    expect(() => assertDeksDocument(presentation)).not.toThrow();
    expect(presentation.format).toBe("deks");
    expect(presentation.id).toBe("presentation-1");
    expect(presentation.revision).toBe(0);
    expect(presentation.canvas).toEqual({ width: 1600, height: 900 });
    expect(presentation.slides).toHaveLength(1);
    // El contrato canónico separa identidad de checkpoint: una slide nueva no
    // trae elementos incrustados.
    expect(presentation.slides[0]?.states).toEqual([]);
    expect(presentation.elements).toEqual([]);
  });

  it("usa panorámica cuando no se pide un tamaño", () => {
    expect(createPresentation("Sin tamaño").canvas).toEqual({ width: 1920, height: 1080 });
  });
});

describe("backgroundCss", () => {
  it("traduce los fondos canónicos y tolera una presentación sin slides", () => {
    expect(backgroundCss({ kind: "solid", color: "#0B1020" })).toBe("#0B1020");
    expect(backgroundCss({ kind: "linear-gradient", angleDeg: 130, startColor: "#0A0", endColor: "#1A1" }))
      .toBe("linear-gradient(130deg, #0A0, #1A1)");
    expect(backgroundCss(null)).toBe("var(--color-surface-raised)");
  });
});
