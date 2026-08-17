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

/** Slide nueva con el fondo del documento, para no estrenar un blanco ajeno. */
export function createSlide(document: DeksDocument, name: string): DeksSlide {
  return {
    id: id("slide"),
    name,
    isTemplate: false,
    background: { kind: "solid", color: document.palette.background },
    inPreset: "fade",
    outPreset: "fade",
    inDurationMultiplier: 1,
    outDurationMultiplier: 1,
    states: [],
  };
}

/** Copia una slide con estados intactos y una identidad propia. */
export function duplicateSlide(slide: DeksSlide, name: string): DeksSlide {
  return { ...structuredClone(slide), id: id("slide"), name };
}

export function clampOpacity(value: number) {
  return Math.min(1, Math.max(0, value));
}
