import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeksCommands, createDeksFile, readDeksFile, type DeksDocument } from "@deks-js/document";
import { createPresentation } from "../src/model";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { openProject, saveProject } from "../src/desktop-api";

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/6WQzgAAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
const SVG_SOURCE = new Uint8Array([...new TextEncoder().encode('<svg height="50" width="100" xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0 L100 50 Z"/></svg>')]);
const SVG_CANONICAL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0 L100 50 Z" fill="#fff"/></svg>';

async function packagedDocument(): Promise<{ document: DeksDocument; bytes: Uint8Array }> {
  const document: DeksDocument = {
    ...createPresentation("Portable", { width: 1600, height: 900 }, "portable"),
    assets: [{ id: "asset-1", kind: "embedded", mediaType: "image/png", originalFilename: "pixel.png" }],
  };
  const file = await createDeksFile(document, [{ id: "asset-1", mediaType: "image/png", bytes: PNG }]);
  return { document, bytes: file.bytes };
}

describe("proyecto Desktop file-first", () => {
  beforeEach(() => invoke.mockReset());

  it("abre un .deks con el documento y los bytes incrustados", async () => {
    const fixture = await packagedDocument();
    invoke.mockResolvedValue({ path: "/decks/portable.deks", bytes: [...fixture.bytes], fingerprint: "first" });

    const opened = await openProject("/decks/portable.deks");

    expect(opened.document).toEqual(fixture.document);
    expect(opened.assets[0]!.bytes).toEqual(PNG);
    expect(invoke).toHaveBeenCalledWith("read_deks_file", { path: "/decks/portable.deks" });
  });

  it("reempaca todos los assets y entrega la huella abierta al CAS de Rust", async () => {
    const fixture = await packagedDocument();
    invoke
      .mockResolvedValueOnce({ path: "/decks/portable.deks", bytes: [...fixture.bytes], fingerprint: "first" })
      .mockImplementationOnce(async (command, payload) => {
        expect(command).toBe("write_deks_file");
        expect(payload.expectedFingerprint).toBe("first");
        const reopened = await readDeksFile(new Uint8Array(payload.bytes));
        expect(reopened.assets[0]!.bytes).toEqual(PNG);
        return { path: payload.path, bytes: payload.bytes, fingerprint: "second" };
      });
    const opened = await openProject("/decks/portable.deks");
    const next = applyDeksCommands(opened.document, [{ type: "update-document", patch: { name: "Editado" } }]).document;

    const saved = await saveProject(opened, opened.document.revision, next);

    expect(saved.document.name).toBe("Editado");
    expect(saved.fingerprint).toBe("second");
    expect(saved.assets[0]!.bytes).toEqual(PNG);
  });

  it("valida y normaliza todos los assets SVG al abrir un .deks directo", async () => {
    const document: DeksDocument = {
      ...createPresentation("Vector", { width: 1600, height: 900 }, "vector"),
      assets: [{ id: "asset-svg", kind: "embedded", mediaType: "image/svg+xml", originalFilename: "brand.svg" }],
    };
    const file = await createDeksFile(document, [{ id: "asset-svg", mediaType: "image/svg+xml", bytes: SVG_SOURCE }]);
    invoke.mockResolvedValue({ path: "/decks/vector.deks", bytes: [...file.bytes], fingerprint: "vector-first" });

    const opened = await openProject("/decks/vector.deks");

    expect(new TextDecoder().decode(opened.assets[0]!.bytes)).toBe(SVG_CANONICAL);
    expect(opened.assets[0]!.mediaType).toBe("image/svg+xml");
  });

  it("rechaza el archivo completo antes de empaquetar cualquier asset inseguro", async () => {
    const document: DeksDocument = {
      ...createPresentation("Unsafe", { width: 1600, height: 900 }, "unsafe"),
      assets: [{ id: "asset-svg", kind: "embedded", mediaType: "image/svg+xml" }],
    };
    const unsafe = new Uint8Array([...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>')]);
    await expect(createDeksFile(document, [
      { id: "asset-svg", mediaType: "image/svg+xml", bytes: unsafe },
    ])).rejects.toThrow("invalid DEKS SVG: element script is unsupported");
  });
});
