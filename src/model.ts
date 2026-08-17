import { DeksPresentation, assertDeksDocument, type DeksDocument } from "@deks-js/document";

export interface OpenProject {
  path: string;
  document: DeksDocument;
}

export interface ProjectChanged {
  path: string;
  revision: number;
  origin: "user" | "agent" | "external";
  changedSlideIds: string[];
  changedElementIds: string[];
}

/**
 * Construye el documento inicial con el builder oficial en vez de un literal
 * escrito a mano. Así la paleta, los presets y la forma canónica los define
 * `@deks-js/document`, y Desktop no puede quedarse con un formato viejo cuando
 * el contrato avanza.
 */
export function createPresentation(name: string, id: string = crypto.randomUUID()): DeksDocument {
  const presentation = new DeksPresentation({
    id,
    name,
    canvas: { width: 1600, height: 900 },
    motionBeatMs: 600,
  });
  presentation.addSlide({ name: "Inicio" });
  const document = presentation.toDocument();
  assertDeksDocument(document);
  return document;
}
