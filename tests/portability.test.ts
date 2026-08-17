import { describe, expect, it } from "vitest";
import {
  applyDeksCommands,
  assertDeksDocument,
  createDeksFile,
  parseDeksJson,
  readDeksFile,
  type DeksCommand,
} from "@deks-js/document";
import { createElement, createSlide, duplicateSlide } from "../src/editor/elements";
import { createPresentation } from "../src/model";

/**
 * La promesa del editor de escritorio no es verse igual que la web: es escribir
 * el mismo documento. Estas pruebas ejercen las mismas operaciones que hace la
 * interfaz y comprueban que lo que queda en disco sigue siendo DEKS canónico,
 * porque eso es lo que permite abrir en la web lo que se exportó acá.
 */
describe("portabilidad del documento editado en escritorio", () => {
  const seed = () => createPresentation("Portátil", { width: 1600, height: 900 }, "deck-1");

  it("mantiene el documento canónico después de insertar cada tipo de elemento", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;

    for (const kind of ["text", "rectangle", "ellipse", "line", "icon"] as const) {
      const { element, state } = createElement(document, slideId, kind);
      document = applyDeksCommands(document, [
        { type: "define-element", element },
        { type: "add-element-state", slideId, state },
      ]).document;
    }

    expect(() => assertDeksDocument(document)).not.toThrow();
    expect(document.elements).toHaveLength(5);
    expect(document.slides[0]!.states).toHaveLength(5);
    // Identidad y checkpoint siguen separados: el editor nunca incrusta la
    // proyección que usa en pantalla.
    expect(document.elements[0]).not.toHaveProperty("x");
    expect(document.slides[0]!.states[0]).not.toHaveProperty("kind");
  });

  it("sobrevive un viaje completo por JSON, que es como lo abre la web", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "text");
    const second = createSlide(document, "Cierre");

    document = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
      { type: "create-slide", slide: second, afterSlideId: slideId },
      { type: "update-element-state", slideId, elementId: element.id, patch: { x: 120, y: 240 } },
      { type: "update-slide", slideId: second.id, patch: { background: { kind: "solid", color: "#101418" } } },
    ] satisfies DeksCommand[]).document;

    const reopened = parseDeksJson(JSON.stringify(document));
    expect(reopened).toEqual(document);
    expect(reopened.slides).toHaveLength(2);
    expect(reopened.slides[0]!.states[0]).toMatchObject({ x: 120, y: 240 });
  });

  it("exporta un archivo .deks que vuelve a leerse con el mismo documento", async () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "icon");
    document = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
    ]).document;

    const archive = await createDeksFile(document);
    const read = await readDeksFile(archive.bytes);

    expect(read.document).toEqual(document);
    expect(() => assertDeksDocument(read.document)).not.toThrow();
  });

  it("duplicar una slide conserva sus estados y estrena identidad", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "rectangle");
    document = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
    ]).document;

    const copy = duplicateSlide(document.slides[0]!, "Copia");
    document = applyDeksCommands(document, [{ type: "create-slide", slide: copy, afterSlideId: slideId }]).document;

    expect(copy.id).not.toBe(slideId);
    expect(document.slides[1]!.states).toEqual(document.slides[0]!.states);
    // La identidad se comparte entre checkpoints: es lo que deja que un
    // elemento viaje entre slides en vez de aparecer y desaparecer.
    expect(document.elements).toHaveLength(1);
    expect(() => assertDeksDocument(document)).not.toThrow();
  });

  it("cada lote de comandos avanza exactamente una revisión y reporta lo que tocó", () => {
    const document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "text");

    const result = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
    ]);

    // El host guarda con `expectedRevision`, así que un lote que saltara dos
    // revisiones haría fallar toda escritura siguiente.
    expect(result.document.revision).toBe(document.revision + 1);
    expect(result.changeSet.changedSlideIds).toContain(slideId);
    expect(result.changeSet.changedElementIds).toContain(element.id);
  });
});
