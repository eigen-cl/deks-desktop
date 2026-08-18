import { describe, expect, it } from "vitest";
import { snapBox } from "../src/editor/snapping";

const canvas = { width: 1000, height: 1000 };
const base = {
  moved: { x: 0, y: 0, width: 100, height: 100 },
  others: [] as Array<{ id: string; x: number; y: number; width: number; height: number }>,
  canvas,
  threshold: 10,
  mode: "move" as const,
  snapToGrid: false,
  snapToElements: true,
  gridStep: 16,
};

describe("snapBox", () => {
  it("pega el borde al lienzo cuando queda dentro de la tolerancia", () => {
    const { box, guides } = snapBox({ ...base, moved: { x: 4, y: 7, width: 100, height: 100 } });
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(guides).toEqual([{ axis: "x", value: 0 }, { axis: "y", value: 0 }]);
  });

  it("centra contra el eje del lienzo usando el centro del elemento", () => {
    const { box } = snapBox({ ...base, moved: { x: 448, y: 300, width: 100, height: 100 } });
    // El centro queda en 500: el ajuste mueve la caja, no la deforma.
    expect(box.x).toBe(450);
    expect(box.width).toBe(100);
  });

  it("alinea con el borde de otro elemento y lo dibuja como guía", () => {
    const { box, guides } = snapBox({
      ...base,
      moved: { x: 297, y: 400, width: 100, height: 100 },
      others: [{ id: "other", x: 300, y: 800, width: 50, height: 50 }],
    });
    expect(box.x).toBe(300);
    expect(guides).toContainEqual({ axis: "x", value: 300 });
  });

  it("no ajusta a otros elementos cuando el imán está apagado", () => {
    const { box, guides } = snapBox({
      ...base,
      snapToElements: false,
      moved: { x: 297, y: 397, width: 100, height: 100 },
      others: [{ id: "other", x: 300, y: 400, width: 50, height: 50 }],
    });
    expect(box).toEqual({ x: 297, y: 397, width: 100, height: 100 });
    expect(guides).toEqual([]);
  });

  it("ajusta a la cuadrícula sin dibujar una guía por cada paso", () => {
    const { box, guides } = snapBox({
      ...base,
      snapToElements: false,
      snapToGrid: true,
      moved: { x: 253, y: 253, width: 100, height: 100 },
    });
    expect(box.x).toBe(256);
    expect(box.y).toBe(256);
    expect(guides).toEqual([]);
  });

  it("al redimensionar mueve el borde y nunca el origen", () => {
    const { box } = snapBox({
      ...base,
      mode: "resize",
      moved: { x: 100, y: 100, width: 196, height: 150 },
      others: [{ id: "other", x: 300, y: 0, width: 20, height: 20 }],
    });
    expect(box.x).toBe(100);
    expect(box.width).toBe(200);
    expect(box.height).toBe(150);
  });
});
