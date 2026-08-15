import { describe, expect, it, vi } from "vitest";
import { createPresentation } from "../src/model";

describe("createPresentation", () => {
  it("namespaces every initial identity with its presentation id", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "generated" });
    const presentation = createPresentation("Automatizable", "presentation-1");

    expect(presentation.id).toBe("presentation-1");
    expect(presentation.slides[0]?.id).toBe("presentation-1:slide:generated");
    expect(presentation.revision).toBe(0);
  });
});
