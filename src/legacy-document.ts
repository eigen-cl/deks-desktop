import {
  DEFAULT_MOTION as CORE_DEFAULT_MOTION,
  assertDeksDocument,
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
 * Una carpeta en disco es del usuario: abrirla no puede fallar sólo porque el
 * formato avanzó. Esta migración ocurre en memoria; el archivo se reescribe con
 * la forma canónica en el primer guardado.
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

export function upgradeLegacyDocument(value: unknown): DeksDocument {
  const legacy = value as Record<string, any>;
  const identities = new Map<string, DeksElement>();
  const slides = (legacy.slides ?? []).map((slide: Record<string, any>) => {
    const states: DeksElementState[] = (slide.elements ?? []).map((element: Record<string, any>) => {
      const id = canonicalId(String(element.id));
      const identity: Record<string, unknown> = { id };
      const state: Record<string, unknown> = { elementId: id };
      for (const [key, entry] of Object.entries(element)) {
        if (key === "id") continue;
        if (IDENTITY_KEYS.has(key)) identity[key] = entry;
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

  const document = {
    format: "deks" as const,
    id: canonicalId(String(legacy.id)),
    name: String(legacy.name ?? "Presentación"),
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
  } as unknown as DeksDocument;

  assertDeksDocument(document);
  return document;
}

/** Devuelve el documento canónico, migrando sólo si hace falta. */
export function toCanonicalDocument(value: unknown): DeksDocument {
  if (!isLegacyDocument(value)) {
    assertDeksDocument(value);
    return value;
  }
  return upgradeLegacyDocument(value);
}
