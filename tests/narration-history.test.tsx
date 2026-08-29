import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeksCommands, createDeksFile, readDeksFile, type DeksDocument, type DeksFileAsset } from "@deks-js/document";
import { Editor } from "../src/editor/Editor";
import { translator } from "../src/i18n";
import { createPresentation } from "../src/model";

const recorder = vi.hoisted(() => ({ begin: vi.fn(), cancel: vi.fn(), stop: vi.fn() }));
vi.mock("../src/editor/narration-audio", () => ({ beginNarrationRecording: recorder.begin }));
vi.mock("@deks-js/renderer-core", () => ({
  RendererCore: class {
    mount(host: HTMLElement) { host.replaceChildren(); }
    setViewportMode() {}
    renderSlide() {}
    compileTransition() { return {}; }
    async play() {}
    destroy() {}
  },
}));

function wav(sample: number): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  }
  view.setUint32(4, 38, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 2, true);
  view.setInt16(44, sample, true);
  return bytes;
}

function narratedSource(): DeksDocument {
  const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck-history");
  return applyDeksCommands(source, [
    { type: "define-asset", asset: { id: "voice-old", kind: "embedded", mediaType: "audio/wav" } },
    {
      type: "set-slide-narration", slideId: source.slides[0]!.id,
      narration: {
        script: "Guion reversible", pauseBeforeMs: 0, pauseAfterMs: 0,
        audio: { assetId: "voice-old", provenance: "human-recorded" },
      },
    },
  ]).document;
}

async function setupHistory() {
  const oldAsset = { id: "voice-old", mediaType: "audio/wav", bytes: wav(1) } as DeksFileAsset;
  const newAsset = { id: "voice-new", mediaType: "audio/wav", bytes: wav(2) } as DeksFileAsset;
  const available = [oldAsset, newAsset];
  const saved: DeksDocument[] = [];
  const errors: unknown[] = [];
  render(
    <Editor
      t={translator("es")}
      source={narratedSource()}
      persistence={{
        save: async (_revision, document) => {
          try {
            const embedded = new Set(document.assets.filter(({ kind }) => kind === "embedded").map(({ id }) => id));
            const archive = await createDeksFile(document, available.filter(({ id }) => embedded.has(id)));
            const reopened = await readDeksFile(archive.bytes);
            saved.push(reopened.document);
            return reopened.document;
          } catch (error) {
            errors.push(error);
            throw error;
          }
        },
      }}
      saveState="idle"
      assets={[oldAsset]}
      onImportAsset={async () => undefined}
      onImportNarrationAsset={async () => ({ id: "voice-new", mediaType: "audio/wav" })}
      onExit={() => undefined}
    />,
  );
  return { saved, errors, oldAsset, newAsset };
}

beforeEach(() => {
  recorder.cancel.mockReset();
  recorder.stop.mockReset().mockResolvedValue(wav(2));
  recorder.begin.mockReset().mockResolvedValue({ cancel: recorder.cancel, stop: recorder.stop });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn(() => Promise.resolve()) });
});

describe("historial portable de narración", () => {
  it("borra, deshace, vuelve a empaquetar y permite escuchar el audio restaurado", async () => {
    const user = userEvent.setup();
    const { saved, errors } = await setupHistory();

    await user.click(screen.getByRole("button", { name: "Borrar narración" }));
    await waitFor(() => expect(saved.length + errors.length).toBe(1));
    expect(errors).toEqual([]);
    expect(saved[0]?.slides[0]?.narration).toBeUndefined();
    expect(saved.at(-1)?.assets.map(({ id }) => id)).toContain("voice-old");

    const undo = screen.getByRole("button", { name: "Deshacer" });
    await waitFor(() => expect(undo).toBeEnabled());
    await user.click(undo);
    await waitFor(() => expect(saved.at(-1)?.slides[0]?.narration?.audio?.assetId).toBe("voice-old"));
    const restored = screen.getByLabelText<HTMLAudioElement>("Audio de narración");
    await restored.play();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("reemplaza, deshace y conserva los bytes de la toma anterior", async () => {
    const user = userEvent.setup();
    const { saved, errors } = await setupHistory();

    await user.click(screen.getByRole("button", { name: "Reemplazar grabación" }));
    await user.click(await screen.findByRole("button", { name: "Detener" }));
    await waitFor(() => expect(saved.length + errors.length).toBe(1));
    expect(errors).toEqual([]);
    expect(saved.at(-1)?.slides[0]?.narration?.audio?.assetId).toBe("voice-new");
    expect(saved.at(-1)?.assets.map(({ id }) => id)).toEqual(expect.arrayContaining(["voice-old", "voice-new"]));

    const undo = screen.getByRole("button", { name: "Deshacer" });
    await waitFor(() => expect(undo).toBeEnabled());
    await user.click(undo);
    await waitFor(() => expect(saved.at(-1)?.slides[0]?.narration?.audio?.assetId).toBe("voice-old"));
    await screen.getByLabelText<HTMLAudioElement>("Audio de narración").play();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});
