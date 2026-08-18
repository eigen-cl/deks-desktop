import type {
  DeksDocument,
  DeksElement,
  DeksElementState,
  DeksSlide,
} from "@deks-js/document";

/**
 * Proyección efímera del editor: identidad y checkpoint juntos, que es como se
 * manipula un elemento en pantalla. El documento nunca guarda esta forma —
 * separa `elements` de `states` — así que sólo vive mientras se edita.
 */
export type EditorElement = DeksElement & Omit<DeksElementState, "elementId">;

export type InsertableKind = "text" | "rectangle" | "ellipse" | "line" | "icon";

export interface ImportedAsset {
  id: string;
  mediaType: string;
  originalFilename?: string;
}

export const id = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function slideOf(document: DeksDocument, slideId: string): DeksSlide {
  const slide = document.slides.find(({ id: value }) => value === slideId);
  if (!slide) throw new Error(`Unknown DEKS slide: ${slideId}`);
  return slide;
}

/** Une identidad y checkpoint para una slide, en orden de pintado. */
export function editorElements(document: DeksDocument, slideId: string): EditorElement[] {
  const identities = new Map(document.elements.map((element) => [element.id, element]));
  return slideOf(document, slideId).states
    .flatMap((state) => {
      const identity = identities.get(state.elementId);
      if (!identity) return [];
      const { elementId: _ignored, ...rest } = state;
      return [{ ...identity, ...rest } satisfies EditorElement];
    })
    .sort((left, right) => left.zIndex - right.zIndex);
}

export function elementState(document: DeksDocument, slideId: string, elementId: string) {
  return slideOf(document, slideId).states.find((state) => state.elementId === elementId);
}

function nextZIndex(document: DeksDocument, slideId: string) {
  const states = slideOf(document, slideId).states;
  return states.reduce((highest, state) => Math.max(highest, state.zIndex), 0) + 1;
}

/**
 * Un elemento nuevo nace centrado y proporcional al lienzo, no en píxeles
 * fijos: la misma inserción tiene que verse igual en 1920×1080 y en 1080×1080.
 */
export function createElement(
  document: DeksDocument,
  slideId: string,
  kind: InsertableKind,
): { element: DeksElement; state: DeksElementState } {
  const { width, height } = document.canvas;
  const elementId = id("element");
  const zIndex = nextZIndex(document, slideId);
  const box = (widthRatio: number, heightRatio: number) => ({
    width: Math.round(width * widthRatio),
    height: Math.round(height * heightRatio),
    x: Math.round((width - width * widthRatio) / 2),
    y: Math.round((height - height * heightRatio) / 2),
  });
  const base = { elementId, rotationDeg: 0, opacity: 1, zIndex };

  if (kind === "text") {
    return {
      element: { id: elementId, kind: "text", name: "Texto", isLocked: false },
      state: {
        ...base,
        ...box(0.7, 0.18),
        content: "Nuevo texto",
        fill: document.palette.text,
        fontFamily: "Poppins",
        fontSize: Math.round(height * 0.07),
        fontWeight: 600,
        lineHeight: 1.15,
        letterSpacing: 0,
        horizontalAlignment: "left",
        verticalAlignment: "middle",
        overflowMode: "hidden",
      },
    };
  }
  if (kind === "icon") {
    const side = Math.round(Math.min(width, height) * 0.16);
    return {
      element: { id: elementId, kind: "icon", name: "Ícono", isLocked: false },
      state: {
        ...base,
        width: side,
        height: side,
        x: Math.round((width - side) / 2),
        y: Math.round((height - side) / 2),
        iconFamily: "lucide",
        iconName: "shield-check",
        fill: document.palette.secondary,
        strokeWidth: 2,
      },
    };
  }
  // Una forma canónica declara relleno, trazo y grosor: los tres son
  // obligatorios en el documento, así que omitir uno produce un archivo que la
  // web rechaza al abrirlo. `line` además exige relleno sólido.
  if (kind === "line") {
    return {
      element: { id: elementId, kind: "shape", shapeKind: "line", name: "Línea", isLocked: false },
      state: {
        ...base,
        ...box(0.4, 0.01),
        shapeFill: { kind: "solid", color: document.palette.primary },
        stroke: document.palette.primary,
        strokeWidth: 4,
      },
    };
  }
  const shapeKind = kind === "ellipse" ? "ellipse" : "rectangle";
  return {
    element: {
      id: elementId,
      kind: "shape",
      shapeKind,
      name: shapeKind === "ellipse" ? "Elipse" : "Rectángulo",
      isLocked: false,
    },
    state: {
      ...base,
      ...box(0.28, 0.28),
      shapeFill: { kind: "solid", color: document.palette.primary },
      // El trazo es un color hexadecimal obligatorio; con grosor 0 no se ve,
      // y al subirlo aparece en el mismo tono del relleno en vez de en negro.
      stroke: document.palette.primary,
      strokeWidth: 0,
    },
  };
}

/**
 * Una imagen entra como cualquier otro elemento: identidad, checkpoint y un
 * `assetId` que apunta al descriptor. El encuadre nace `contain` para que nada
 * se recorte antes de que alguien lo decida.
 */
export function createImageElement(
  document: DeksDocument,
  slideId: string,
  asset: ImportedAsset,
): { element: DeksElement; state: DeksElementState } {
  const { width, height } = document.canvas;
  const elementId = id("element");
  const boxWidth = Math.round(width * 0.45);
  const boxHeight = Math.round(height * 0.45);
  return {
    element: {
      id: elementId,
      kind: "image",
      name: asset.originalFilename ?? "Imagen",
      isLocked: false,
    },
    state: {
      elementId,
      x: Math.round((width - boxWidth) / 2),
      y: Math.round((height - boxHeight) / 2),
      width: boxWidth,
      height: boxHeight,
      rotationDeg: 0,
      opacity: 1,
      zIndex: nextZIndex(document, slideId),
      assetId: asset.id,
      alt: asset.originalFilename ?? "Imagen",
      fit: "contain",
    },
  };
}

/**
 * Identidades que existen en la presentación pero no en esta slide, con el
 * checkpoint más cercano del que copiarlas. Reaparecer un elemento en otra
 * slide es lo que hace continuo un deck: el renderer interpola entre los dos
 * checkpoints de la misma identidad en vez de cortar.
 */
export function elementsElsewhere(
  document: DeksDocument,
  slideId: string,
): Array<{ element: EditorElement; sourceSlideId: string }> {
  const present = new Set(slideOf(document, slideId).states.map((state) => state.elementId));
  const found = new Map<string, { element: EditorElement; sourceSlideId: string }>();
  for (const slide of document.slides) {
    if (slide.id === slideId) continue;
    for (const element of editorElements(document, slide.id)) {
      if (present.has(element.id) || found.has(element.id)) continue;
      found.set(element.id, { element, sourceSlideId: slide.id });
    }
  }
  return [...found.values()];
}

/** Copia el checkpoint de otra slide para estrenar el elemento en esta. */
export function stateForSlide(
  document: DeksDocument,
  slideId: string,
  elementId: string,
  sourceSlideId: string,
  position?: { x: number; y: number },
): DeksElementState {
  const source = elementState(document, sourceSlideId, elementId);
  if (!source) throw new Error(`Unknown DEKS element state: ${elementId}`);
  return {
    ...structuredClone(source),
    ...(position ? { x: position.x, y: position.y } : {}),
    zIndex: nextZIndex(document, slideId),
  };
}

/**
 * Duplica un elemento como una identidad nueva, desplazado lo justo para que la
 * copia se vea encima del original en vez de esconderse debajo.
 */
export function duplicateElement(
  document: DeksDocument,
  slideId: string,
  source: EditorElement,
): { element: DeksElement; state: DeksElementState } {
  const state = elementState(document, slideId, source.id);
  if (!state) throw new Error(`Unknown DEKS element state: ${source.id}`);
  const elementId = id("element");
  const offset = Math.round(Math.min(document.canvas.width, document.canvas.height) * 0.02);
  return {
    element: { ...identityOf(source), id: elementId },
    state: {
      ...structuredClone(state),
      elementId,
      x: state.x + offset,
      y: state.y + offset,
      zIndex: nextZIndex(document, slideId),
    },
  };
}

/**
 * Intercambia el orden de pintado con el vecino inmediato. Devuelve dos
 * parches porque `zIndex` es una posición relativa: subir uno sin bajar al otro
 * dejaría dos elementos empatados y el orden dependería del azar.
 */
export function swapZIndex(
  document: DeksDocument,
  slideId: string,
  elementId: string,
  direction: -1 | 1,
): Array<{ elementId: string; zIndex: number }> {
  const ordered = editorElements(document, slideId);
  const index = ordered.findIndex((element) => element.id === elementId);
  const neighbour = ordered[index + direction];
  const current = ordered[index];
  if (!current || !neighbour) return [];
  return [
    { elementId: current.id, zIndex: neighbour.zIndex },
    { elementId: neighbour.id, zIndex: current.zIndex },
  ];
}

/** Slide nueva con el fondo del documento, para no estrenar un blanco ajeno. */
export function createSlide(document: DeksDocument, name: string): DeksSlide {
  return {
    id: id("slide"),
    name,
    isTemplate: false,
    background: { kind: "solid", color: document.palette.background },
    states: [],
  };
}

/** Copia una slide con estados intactos y una identidad propia. */
export function duplicateSlide(slide: DeksSlide, name: string): DeksSlide {
  return { ...structuredClone(slide), id: id("slide"), name };
}

/** Devuelve sólo la identidad de un elemento del editor, sin su checkpoint. */
function identityOf(element: EditorElement): DeksElement {
  const { name, isLocked } = element;
  if (element.kind === "shape") {
    return { id: element.id, kind: "shape", shapeKind: element.shapeKind, name, isLocked };
  }
  return { id: element.id, kind: element.kind, name, isLocked } as DeksElement;
}

export function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}
