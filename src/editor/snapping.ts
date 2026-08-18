import type { EditorElement } from "./elements";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Guide {
  axis: "x" | "y";
  value: number;
}

export interface SnapOptions {
  /** Elemento que se está moviendo, ya desplazado por el puntero. */
  moved: Box;
  /** El resto de la slide: sus bordes y centros son los imanes. */
  others: readonly Pick<EditorElement, "id" | "x" | "y" | "width" | "height">[];
  canvas: { width: number; height: number };
  /** Tolerancia en unidades de lienzo, ya convertida desde píxeles. */
  threshold: number;
  mode: "move" | "resize";
  snapToGrid: boolean;
  snapToElements: boolean;
  gridStep: number;
}

export interface SnapResult {
  box: Box;
  guides: Guide[];
}

/**
 * Ajusta una caja a la cuadrícula, a los bordes del lienzo y a los bordes y
 * centros de los demás elementos. Es lógica pura y separada del componente
 * porque es lo que decide dónde queda el elemento: si se equivoca, el documento
 * guarda una posición que nadie pidió.
 *
 * La guía sólo se dibuja cuando el imán fue otro elemento o el lienzo. La
 * cuadrícula no dibuja línea: aparecería en cada píxel y no diría nada.
 */
export function snapBox({
  moved,
  others,
  canvas,
  threshold,
  mode,
  snapToGrid,
  snapToElements,
  gridStep,
}: SnapOptions): SnapResult {
  const guides: Guide[] = [];
  const targets = (axis: "x" | "y") => {
    if (!snapToElements) return [] as number[];
    const size = axis === "x" ? canvas.width : canvas.height;
    const values = [0, size / 2, size];
    for (const other of others) {
      const start = axis === "x" ? other.x : other.y;
      const length = axis === "x" ? other.width : other.height;
      values.push(start, start + length / 2, start + length);
    }
    return values;
  };

  if (mode === "resize") {
    const right = closest(moved.x + moved.width, targets("x"), snapToGrid, gridStep, threshold);
    const bottom = closest(moved.y + moved.height, targets("y"), snapToGrid, gridStep, threshold);
    if (right?.guide) guides.push({ axis: "x", value: right.target });
    if (bottom?.guide) guides.push({ axis: "y", value: bottom.target });
    return {
      box: {
        ...moved,
        width: Math.max(1, moved.width + (right?.delta ?? 0)),
        height: Math.max(1, moved.height + (bottom?.delta ?? 0)),
      },
      guides,
    };
  }

  const horizontal = closestAnchor(
    [moved.x, moved.x + moved.width / 2, moved.x + moved.width],
    targets("x"),
    snapToGrid,
    gridStep,
    threshold,
  );
  const vertical = closestAnchor(
    [moved.y, moved.y + moved.height / 2, moved.y + moved.height],
    targets("y"),
    snapToGrid,
    gridStep,
    threshold,
  );
  if (horizontal?.guide) guides.push({ axis: "x", value: horizontal.target });
  if (vertical?.guide) guides.push({ axis: "y", value: vertical.target });
  return {
    box: { ...moved, x: moved.x + (horizontal?.delta ?? 0), y: moved.y + (vertical?.delta ?? 0) },
    guides,
  };
}

interface Candidate {
  target: number;
  delta: number;
  guide: boolean;
}

/**
 * De los tres anclajes —borde inicial, centro y borde final— sólo el inicial
 * mira la cuadrícula. Dejar que el centro también se pegara movía la caja hasta
 * que su mitad caía en la línea, con lo que ningún borde quedaba sobre ella.
 */
function closestAnchor(
  anchors: number[],
  targets: number[],
  grid: boolean,
  gridStep: number,
  threshold: number,
): Candidate | undefined {
  return anchors
    .map((anchor, index) => closest(anchor, targets, grid && index === 0, gridStep, threshold))
    .filter((candidate): candidate is Candidate => candidate !== undefined)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0];
}

function closest(
  anchor: number,
  targets: number[],
  grid: boolean,
  gridStep: number,
  threshold: number,
): Candidate | undefined {
  const candidates: Candidate[] = targets.map((target) => ({ target, delta: target - anchor, guide: true }));
  if (grid && gridStep > 0) {
    const target = Math.round(anchor / gridStep) * gridStep;
    candidates.push({ target, delta: target - anchor, guide: false });
  }
  return candidates
    .filter((candidate) => Math.abs(candidate.delta) <= threshold)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0];
}
