import { describe, expect, it } from "vitest";
import { assertDeksDocument } from "@deks-js/document";
import { createPresentation } from "../src/model";

describe("createPresentation", () => {
  it("construye un documento canónico con el builder oficial", () => {
    const presentation = createPresentation("Automatizable", "presentation-1");

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
});
