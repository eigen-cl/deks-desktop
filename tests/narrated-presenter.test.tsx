import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeksCommands, type DeksDocument } from "@deks-js/document";
import { Presenter } from "../src/editor/Presenter";
import { createSlide } from "../src/editor/elements";
import { translator } from "../src/i18n";
import { createPresentation } from "../src/model";

const rendered = vi.fn();
const played = vi.fn(() => Promise.resolve());
const paused = vi.fn();

vi.mock("@deks-js/renderer-core", () => ({
  RendererCore: class {
    mount(host: HTMLElement) { host.replaceChildren(); }
    setViewportMode() {}
    renderSlide(_document: unknown, slideId?: string) { rendered(slideId); }
    compileTransition() { return {}; }
    async play() {}
    destroy() {}
  },
}));

function narratedDeck(): DeksDocument {
  const initial = createPresentation("Deck narrado", { width: 1600, height: 900 }, "narrated-deck");
  const second = { ...createSlide(initial, "Cierre"), id: "slide-close" };
  return applyDeksCommands(initial, [
    { type: "define-asset", asset: { id: "voice-one", kind: "embedded", mediaType: "audio/wav" } },
    { type: "define-asset", asset: { id: "voice-two", kind: "embedded", mediaType: "audio/wav" } },
    {
      type: "set-slide-narration",
      slideId: initial.slides[0]!.id,
      narration: {
        script: "Abrimos la historia.", pauseBeforeMs: 0, pauseAfterMs: 0,
        audio: { assetId: "voice-one", provenance: "human-recorded" },
      },
    },
    { type: "create-slide", slide: second, afterSlideId: initial.slides[0]!.id },
    {
      type: "set-slide-narration",
      slideId: second.id,
      narration: {
        script: "Cerramos la historia.", pauseBeforeMs: 0, pauseAfterMs: 0,
        audio: { assetId: "voice-two", provenance: "human-recorded" },
      },
    },
  ]).document;
}

beforeEach(() => {
  rendered.mockClear();
  played.mockClear();
  paused.mockClear();
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: played });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: paused });
  Object.defineProperty(HTMLMediaElement.prototype, "load", { configurable: true, value: vi.fn() });
});

describe("presentación narrada", () => {
  it("espera un gesto manual, reproduce una sola pista y avanza cuando termina", async () => {
    const user = userEvent.setup();
    const deck = narratedDeck();
    render(
      <Presenter
        t={translator("es")}
        document={deck}
        initialSlideId={deck.slides[0]!.id}
        assetUrls={{ "voice-one": "blob:voice-one", "voice-two": "blob:voice-two" }}
        narrated
        onClose={() => undefined}
      />,
    );

    expect(played).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Iniciar narración" }));
    await waitFor(() => expect(played).toHaveBeenCalledTimes(1));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    fireEvent.ended(screen.getByTestId("presenter-narration-audio"));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    await waitFor(() => expect(played).toHaveBeenCalledTimes(2));
  });

  it("cancela la pista vigente al navegar y expone un error de reproducción", async () => {
    const user = userEvent.setup();
    played.mockRejectedValueOnce(new Error("blocked"));
    const deck = narratedDeck();
    render(
      <Presenter
        t={translator("es")}
        document={deck}
        initialSlideId={deck.slides[0]!.id}
        assetUrls={{ "voice-one": "blob:voice-one", "voice-two": "blob:voice-two" }}
        narrated
        onClose={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Iniciar narración" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos reproducir/);
    await user.click(screen.getByRole("button", { name: "Diapositiva siguiente" }));
    expect(paused).toHaveBeenCalled();
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
  });

  it("mantiene el modo narrado al navegar, pero se detiene con alerta si falta audio", async () => {
    const user = userEvent.setup();
    const deck = narratedDeck();
    render(
      <Presenter
        t={translator("es")}
        document={deck}
        initialSlideId={deck.slides[0]!.id}
        assetUrls={{ "voice-one": "blob:voice-one" }}
        narrated
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("2 de 2 diapositivas con audio")).toBeInTheDocument();
    expect(screen.getByLabelText("Audio de narración")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Iniciar narración" }));
    await waitFor(() => expect(played).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Diapositiva siguiente" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no tiene audio");
    expect(played).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Diapositiva anterior" }));
    await waitFor(() => expect(played).toHaveBeenCalledTimes(2));
  });

  it("encierra el foco en el modal y lo devuelve al control que abrió la presentación", async () => {
    const user = userEvent.setup();
    const deck = narratedDeck();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Abrir narración</button>
          {open && (
            <Presenter
              t={translator("es")}
              document={deck}
              initialSlideId={deck.slides[0]!.id}
              assetUrls={{ "voice-one": "blob:voice-one", "voice-two": "blob:voice-two" }}
              narrated
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir narración" });
    opener.focus();
    await user.click(opener);

    expect(screen.getByRole("button", { name: "Iniciar narración" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Salir del modo presentación" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Deck narrado" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
