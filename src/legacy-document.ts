import {
  DEFAULT_MOTION as CORE_DEFAULT_MOTION,
  migrateDeksDocument,
  type DeksCodecMigrationResult,
  type DeksDocument,
  type DeksElement,
  type DeksElementState,
} from "@deks-js/document";

/**
 * Migración de proyectos creados antes del contrato canónico 1.0.
 *
 * Las versiones previas de Desktop guardaban `canvasWidth`/`canvasHeight` y
 * fusionaban identidad y estado dentro de `slides[].elements`. El documento
 * canónico separa la identidad (`elements`) del checkpoint (`slides[].states`) y
 * además restringe la gramática de IDs, que antes admitía `:`.
 *
 * Una carpeta en disco es del usuario: convertirla no puede fallar sólo porque
 * el formato avanzó. Esta migración ocurre en memoria y se empaqueta en un
 * `.deks` vecino; la fuente no se reescribe ni se elimina.
 */

/** Claves que pertenecen a la identidad del elemento; el resto es checkpoint. */
const IDENTITY_KEYS = new Set([
  "id",
  "kind",
  "name",
  "shapeKind",
  "semanticRole",
  "parentId",
  "isLocked",
]);

const CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Los IDs antiguos usaban `:`, que el contrato canónico no acepta. */
export function canonicalId(value: string): string {
  const replaced = value.replace(/[^A-Za-z0-9._-]/g, ".");
  const trimmed = replaced.replace(/^[^A-Za-z0-9]+/, "");
  return CANONICAL_ID.test(trimmed) ? trimmed : `id.${trimmed || "unnamed"}`;
}

export function isLegacyDocument(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  if (document.format === "deks") return false;
  return "canvasWidth" in document || Array.isArray(document.slides);
}

/**
 * Un documento anterior no declara movimiento: hereda el del contrato nuevo.
 * Se toma tal cual de Core en vez de repetirlo, porque una copia a mano ya se
 * quedó atrás cuando el contrato sumó una propiedad y los archivos viejos
 * dejaron de abrir.
 */
const DEFAULT_MOTION = CORE_DEFAULT_MOTION;

function legacyV1Document(value: unknown): unknown {
  const legacy = value as Record<string, any>;
  const identities = new Map<string, DeksElement>();
  const slides = (legacy.slides ?? []).map((slide: Record<string, any>) => {
    const states: DeksElementState[] = (slide.elements ?? []).map((element: Record<string, any>) => {
      const id = canonicalId(String(element.id));
      const identity: Record<string, unknown> = { id };
      const state: Record<string, unknown> = { elementId: id };
      for (const [key, entry] of Object.entries(element)) {
        if (key === "id") continue;
        if (key === "parentId") identity[key] = canonicalId(String(entry));
        else if (IDENTITY_KEYS.has(key)) identity[key] = entry;
        else state[key] = entry;
      }
      identity.isLocked = Boolean(element.isLocked);
      if (!identities.has(id)) identities.set(id, identity as unknown as DeksElement);
      return state as unknown as DeksElementState;
    });
    return {
      id: canonicalId(String(slide.id)),
      name: String(slide.name ?? "Slide"),
      isTemplate: Boolean(slide.isTemplate),
      background: slide.background ?? { kind: "solid", color: "#0b0c0e" },
      states,
    };
  });

  return {
    format: "deks" as const,
    id: canonicalId(String(legacy.id)),
    name: String(legacy.name ?? "Presentation"),
    revision: Number(legacy.revision ?? 0),
    canvas: legacy.canvas ?? {
      width: Number(legacy.canvasWidth ?? 1600),
      height: Number(legacy.canvasHeight ?? 900),
    },
    motionBeatMs: Number(legacy.motionBeatMs ?? 600),
    motion: DEFAULT_MOTION,
    palette: legacy.palette,
    history: legacy.history ?? { canUndo: false, canRedo: false },
    assets: legacy.assets ?? [],
    elements: [...identities.values()],
    slides,
  };
}

export function upgradeLegacyDocument(value: unknown): DeksDocument {
  return migrateDeksDocument(legacyV1Document(value)).document;
}

/**
 * Completa las propiedades de movimiento que el documento no declara.
 *
 * Un archivo escrito por una versión anterior ya es canónico —dice
 * `format: "deks"`— pero puede no traer una propiedad que el contrato sumó
 * después. La declaración raíz tiene que estar completa, así que lo que falta
 * se hereda del contrato vigente en vez de rechazar el archivo: el proyecto es
 * de la persona, y que la app le sume una propiedad no es motivo para no
 * abrírselo. Lo que el documento sí declara nunca se toca.
 */
function completeMotion(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const document = value as Record<string, any>;
  const motion = document.motion;
  if (!motion || typeof motion !== "object") return value;
  const completed: Record<string, unknown> = {};
  for (const role of ["in", "out", "morph"] as const) {
    const declared = motion[role];
    if (!declared || typeof declared !== "object") return value;
    completed[role] = { ...CORE_DEFAULT_MOTION[role], ...declared };
  }
  return { ...document, motion: completed };
}

export function toCanonicalDocumentResult(value: unknown): DeksCodecMigrationResult {
  const source = isLegacyDocument(value) ? legacyV1Document(value) : value;
  return migrateDeksDocument(completeMotion(source));
}

export function toCanonicalDocument(value: unknown): DeksDocument {
  return toCanonicalDocumentResult(value).document;
}
