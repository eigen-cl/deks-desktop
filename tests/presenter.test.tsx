import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeksCommands, assertDeksDocument, type DeksCommand, type DeksDocument } from "@deks-js/document";
import { Presenter } from "../src/editor/Presenter";
import { createElement, createSlide } from "../src/editor/elements";
import { translator } from "../src/i18n";
import { createPresentation } from "../src/model";

interface AnimationRecord {
  elementId: string | undefined;
  keyframes: Keyframe[];
  timing: KeyframeAnimationOptions;
  animation: FinishesOnlyWhenPlayed;
}

class FinishesOnlyWhenPlayed {
  currentTime: CSSNumberish | null = 0;
  playbackRate = 1;
  playState: AnimationPlayState = "paused";
  pause = vi.fn(() => { this.playState = "paused"; });
  cancel = vi.fn(() => { this.playState = "idle"; });
  private resolveFinished!: () => void;
  finished = new Promise<void>((resolve) => { this.resolveFinished = resolve; });
  play = vi.fn(() => {
    this.playState = "running";
    queueMicrotask(() => {
      this.playState = "finished";
      this.resolveFinished();
    });
  });
}

const originalAnimate = Element.prototype.animate;
let animations: AnimationRecord[];

beforeEach(() => {
  animations = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value: function animate(keyframes: Keyframe[] | PropertyIndexedKeyframes, timing: KeyframeAnimationOptions) {
      const animation = new FinishesOnlyWhenPlayed();
      animations.push({
        elementId: (this as HTMLElement).dataset.elementId,
        keyframes: Array.isArray(keyframes) ? keyframes : [],
        timing,
        animation,
      });
      return animation as unknown as Animation;
    },
  });
});

afterEach(() => {
  if (originalAnimate) Element.prototype.animate = originalAnimate;
  else delete (Element.prototype as Partial<Pick<Element, "animate">>).animate;
});

/**
 * Fixture de host, no del compilador: reproduce sólo el borde que Desktop debe
 * poder presentar. Core conserva la responsabilidad de resolver timings,
 * keyframes y la escena final.
 */
function delayedPlaybackDeck(): DeksDocument {
  const initial = createPresentation("Conoce DEKS", { width: 1600, height: 900 }, "presenter-deck");
  const opening = initial.slides[0]!;
  const context = { ...createSlide(initial, "Contexto"), id: "story-context" };
  const track = createElement(initial, opening.id, "rectangle");
  const fill = createElement(initial, opening.id, "rectangle");
  const trackId = "story-progress-track";
  const fillId = "story-progress-fill";

  const document = applyDeksCommands(initial, [
    { type: "create-slide", slide: context, afterSlideId: opening.id },
    { type: "define-element", element: { ...track.element, id: trackId, name: "Pista de progreso" } },
    {
      type: "add-element-state",
      slideId: context.id,
      state: {
        ...track.state,
        elementId: trackId,
        motion: {
          in: {
            animation: { kind: "fade" },
            durationBeats: 0.35,
            delayBeats: 1,
            easing: "ease-out",
          },
        },
      },
    },
    { type: "define-element", element: { ...fill.element, id: fillId, name: "Relleno de progreso" } },
    {
      type: "add-element-state",
      slideId: context.id,
      state: {
        ...fill.state,
        elementId: fillId,
        motion: {
          in: {
            animation: { kind: "wipe", edge: "left" },
            durationBeats: 0.65,
            delayBeats: 1.35,
            easing: "ease-out",
          },
        },
      },
    },
  ] satisfies DeksCommand[]).document;
  assertDeksDocument(document);
  return document;
}

describe("Presenter con el renderer canónico", () => {
  it("inicia y termina el fade y wipe demorados antes de avanzar la escena", async () => {
    const user = userEvent.setup();
    const deck = delayedPlaybackDeck();
    render(
      <Presenter
        t={translator("es")}
        document={deck}
        initialSlideId={deck.slides[0]!.id}
        onClose={() => undefined}
      />,
    );

    // Este stage lo monta RendererCore; Presenter no tiene un renderer paralelo.
    expect(document.querySelector("[data-deks-stage]")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Slide siguiente" }));
    await waitFor(() => expect(animations).toHaveLength(2));

    const track = animations.find(({ elementId }) => elementId === "story-progress-track")!;
    const fill = animations.find(({ elementId }) => elementId === "story-progress-fill")!;
    expect(track.timing).toMatchObject({ duration: 210, delay: 600, easing: "ease-out", fill: "both" });
    expect(track.keyframes[0]).toMatchObject({ opacity: 0 });
    expect(fill.timing).toMatchObject({ duration: 390, delay: 810, easing: "ease-out", fill: "both" });
    expect(fill.keyframes[0]).toMatchObject({ clipPath: "inset(0 100% 0 0)" });
    expect(fill.keyframes[0]?.opacity).toBeUndefined();

    // WKWebView puede crear WAAPI pausadas: el renderer debe iniciarlas de
    // manera explícita y esperar ambas antes de confirmar el checkpoint.
    expect(track.animation.play).toHaveBeenCalledOnce();
    expect(fill.animation.play).toHaveBeenCalledOnce();
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-element-id]")).toHaveLength(2);
  });
});
