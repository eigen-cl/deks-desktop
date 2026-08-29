import { describe, expect, it } from "vitest";
import {
  applyDeksCommands,
  assertDeksDocument,
  createDeksFile,
  parseDeksJson,
  readDeksFile,
  reanchorElementState,
  type DeksCommand,
} from "@deks-js/document";
import { createElement, createSlide, duplicateElement, duplicateSlide, editorElements } from "../src/editor/elements";
import { createPresentation } from "../src/model";
import { encodeNarrationWav } from "../src/editor/narration-audio";

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

    for (const kind of ["text", "rectangle", "ellipse", "line", "diamond", "icon"] as const) {
      const { element, state } = createElement(document, slideId, kind);
      document = applyDeksCommands(document, [
        { type: "define-element", element },
        { type: "add-element-state", slideId, state },
      ]).document;
    }

    expect(() => assertDeksDocument(document)).not.toThrow();
    expect(document.elements).toHaveLength(6);
    expect(document.slides[0]!.states).toHaveLength(6);
    // Identidad y checkpoint siguen separados: el editor nunca incrusta la
    // proyección que usa en pantalla.
    expect(document.elements[0]).not.toHaveProperty("x");
    expect(document.slides[0]!.states[0]).not.toHaveProperty("kind");
    expect(document.codecVersion).toBe(3);
    expect(document.elements[0]).toMatchObject({
      kind: "text",
      content: expect.any(String),
      fontFamily: "Poppins",
      horizontalAlignment: "left",
      verticalAlignment: "middle",
      overflowMode: "hidden",
    });
    expect(document.slides[0]!.states[0]).not.toHaveProperty("content");
  });

  it("guarda padding de cuatro lados sólo en el checkpoint de texto", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "text");
    document = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
      {
        type: "update-element-state",
        slideId,
        elementId: element.id,
        patch: { padding: { top: 8, right: 16, bottom: 24, left: 32 } },
      },
    ]).document;

    expect(document.slides[0]!.states[0]!.padding).toEqual({ top: 8, right: 16, bottom: 24, left: 32 });
    expect(document.elements[0]).not.toHaveProperty("padding");
    expect(() => assertDeksDocument(document)).not.toThrow();
  });

  it("serializa un rombo con anchor normalizado y conserva el punto visual al cambiarlo", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "diamond");
    document = applyDeksCommands(document, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
    ]).document;

    const anchored = reanchorElementState(document.slides[0]!.states[0]!, { x: 0.5, y: 0.5 });
    document = applyDeksCommands(document, [{
      type: "update-element-state",
      slideId,
      elementId: element.id,
      patch: { x: anchored.x, y: anchored.y, anchor: anchored.anchor },
    }]).document;

    expect(document.elements[0]).toMatchObject({ kind: "shape", shapeKind: "diamond" });
    expect(document.slides[0]!.states[0]).toMatchObject({ anchor: { x: 0.5, y: 0.5 } });
    expect(() => assertDeksDocument(document)).not.toThrow();
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

  it("conserva los bytes de una imagen al viajar por el archivo .deks", async () => {
    const pixels = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/6WQzgAAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
    const document = {
      ...seed(),
      assets: [{ id: "asset-1", kind: "embedded" as const, mediaType: "image/png", originalFilename: "pixel.png" }],
    };

    const archive = await createDeksFile(document, [{ id: "asset-1", mediaType: "image/png", bytes: pixels }]);
    const reopened = await readDeksFile(archive.bytes);

    expect(reopened.document).toEqual(document);
    expect(reopened.assets).toHaveLength(1);
    expect(reopened.assets[0]!.id).toBe("asset-1");
    expect(reopened.assets[0]!.bytes).toEqual(pixels);
  });

  it("conserva guion, pausas, procedencia y WAV al viajar por el archivo .deks", async () => {
    const wav = encodeNarrationWav([new Float32Array(2_400)], 24_000);
    let document = seed();
    const slideId = document.slides[0]!.id;
    document = applyDeksCommands(document, [
      { type: "define-asset", asset: { id: "voice-1", kind: "embedded", mediaType: "audio/wav" } },
      {
        type: "set-slide-narration",
        slideId,
        narration: {
          script: "Este audio permanece con la diapositiva.",
          pauseBeforeMs: 250,
          pauseAfterMs: 500,
          audio: { assetId: "voice-1", provenance: "human-recorded" },
        },
      },
    ]).document;

    const archive = await createDeksFile(document, [{ id: "voice-1", mediaType: "audio/wav", bytes: wav }]);
    const reopened = await readDeksFile(archive.bytes);

    expect(reopened.document.slides[0]!.narration).toEqual(document.slides[0]!.narration);
    expect(reopened.assets[0]!.mediaType).toBe("audio/wav");
    expect(reopened.assets[0]!.bytes).toEqual(wav);
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

  it("duplicar un elemento conserva su grupo lógico sin copiar geometría a la identidad", () => {
    let document = seed();
    const slideId = document.slides[0]!.id;
    const { element, state } = createElement(document, slideId, "rectangle");
    document = applyDeksCommands(document, [
      { type: "define-element", element: { id: "group-1", kind: "group", name: "Hero", isLocked: false } },
      { type: "define-element", element: { ...element, parentId: "group-1" } },
      { type: "add-element-state", slideId, state },
    ]).document;

    const copy = duplicateElement(document, slideId, editorElements(document, slideId)[0]!);

    expect(copy.element.parentId).toBe("group-1");
    expect(copy.element).not.toHaveProperty("x");
    expect(copy.state.x).not.toBe(state.x);
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
