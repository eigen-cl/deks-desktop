import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, X } from "lucide-react";
import { RendererCore } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";
import type { Translate } from "../i18n";

export interface PresenterProps {
  t: Translate;
  document: DeksDocument;
  initialSlideId: string;
  /** URLs efímeras por asset: sin ellas una imagen no se ve al presentar. */
  assetUrls?: Record<string, string>;
  /** Arranque explícito y avance guiado por el audio de cada checkpoint. */
  narrated?: boolean;
  onClose(): void;
}

/**
 * Reproduce el deck con el mismo motor que dibuja el editor, así que una
 * transición se ve aquí igual que en la web. Core resuelve la arista desde el
 * documento; el escritorio sólo decide cuándo avanzar.
 */
export function Presenter({ t, document: deck, initialSlideId, assetUrls, narrated = false, onClose }: PresenterProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const moving = useRef(false);
  const [awake, setAwake] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const narrationTimer = useRef(0);
  const narrationGeneration = useRef(0);
  const narrationStarted = useRef(false);
  const narratedIndex = useRef<number>();
  const [started, setStarted] = useState(false);
  const [narrationStatus, setNarrationStatus] = useState<"idle" | "waiting" | "playing" | "finished" | "missing" | "error">("idle");
  const assets = useRef(assetUrls);
  assets.current = assetUrls;
  const [index, setIndex] = useState(() => {
    const found = deck.slides.findIndex(({ id }) => id === initialSlideId);
    return found < 0 ? 0 : found;
  });
  const indexRef = useRef(index);
  indexRef.current = index;
  const narratedSlideCount = deck.slides.filter((slide) => slide.narration?.audio).length;

  const cancelNarration = useCallback(() => {
    narrationGeneration.current += 1;
    window.clearTimeout(narrationTimer.current);
    const element = audio.current;
    if (element) {
      element.pause();
      element.currentTime = 0;
    }
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const instance = new RendererCore({
      respectReducedMotion: true,
      assetResolver: ({ assetId }) => (assetId ? assets.current?.[assetId] : undefined),
    });
    instance.mount(host.current);
    instance.setViewportMode("presentation");
    instance.renderSlide(deck, deck.slides[index]!.id);
    renderer.current = instance;
    return () => {
      cancelNarration();
      instance.destroy();
      renderer.current = undefined;
    };
    // Se monta una vez: avanzar es reproducir, no volver a montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelNarration]);

  useEffect(() => {
    const root = dialog.current;
    if (!root) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const siblings = root.parentElement
      ? [...root.parentElement.children].filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement && candidate !== root)
      : [];
    const previous = siblings.map((candidate) => ({
      candidate,
      inert: candidate.inert,
      ariaHidden: candidate.getAttribute("aria-hidden"),
    }));
    for (const sibling of siblings) {
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    (narrated ? startButton.current ?? root : root).focus();
    return () => {
      for (const state of previous) {
        state.candidate.inert = state.inert;
        if (state.ariaHidden === null) state.candidate.removeAttribute("aria-hidden");
        else state.candidate.setAttribute("aria-hidden", state.ariaHidden);
      }
      previousFocus?.focus();
    };
  }, [narrated]);

  const move = useCallback(async (direction: -1 | 1) => {
    const current = indexRef.current;
    const target = current + direction;
    if (moving.current || target < 0 || target >= deck.slides.length) return;
    cancelNarration();
    moving.current = true;
    try {
      const from = deck.slides[current]!.id;
      const to = deck.slides[target]!.id;
      const instance = renderer.current;
      if (instance) {
        try {
          instance.compileTransition(deck, from, to);
          await instance.play();
        } catch {
          // Sin arista declarada el salto es un corte, no un error visible.
          instance.renderSlide(deck, to);
        }
      }
      indexRef.current = target;
      setIndex(target);
    } finally {
      moving.current = false;
    }
  }, [cancelNarration, deck]);

  const playNarration = useCallback((target: number) => {
    cancelNarration();
    if (!narrated || !narrationStarted.current) return;
    narratedIndex.current = target;
    const generation = narrationGeneration.current;
    const narration = deck.slides[target]?.narration;
    const source = narration?.audio ? assets.current?.[narration.audio.assetId] : undefined;
    if (!narration?.audio || !source) {
      setNarrationStatus("missing");
      return;
    }
    setNarrationStatus("waiting");
    const beginPlayback = () => {
      if (generation !== narrationGeneration.current) return;
      const element = audio.current;
      if (!element) return;
      element.currentTime = 0;
      void element.play().then(() => {
        if (generation === narrationGeneration.current) setNarrationStatus("playing");
      }).catch(() => {
        if (generation === narrationGeneration.current) setNarrationStatus("error");
      });
    };
    if (narration.pauseBeforeMs === 0) beginPlayback();
    else narrationTimer.current = window.setTimeout(beginPlayback, narration.pauseBeforeMs);
  }, [cancelNarration, deck.slides, narrated]);

  useEffect(() => {
    if (started && narratedIndex.current !== index) playNarration(index);
  }, [index, playNarration, started]);

  const startNarration = () => {
    narrationStarted.current = true;
    setStarted(true);
    playNarration(indexRef.current);
  };

  const narrationEnded = () => {
    const generation = narrationGeneration.current;
    const narration = deck.slides[indexRef.current]?.narration;
    if (!narration) return;
    setNarrationStatus("waiting");
    narrationTimer.current = window.setTimeout(() => {
      if (generation !== narrationGeneration.current) return;
      if (indexRef.current >= deck.slides.length - 1) {
        setNarrationStatus("finished");
        return;
      }
      void move(1);
    }, narration.pauseAfterMs);
  };

  const close = useCallback(() => {
    narrationStarted.current = false;
    cancelNarration();
    onClose();
  }, [cancelNarration, onClose]);

  /**
   * Los controles duermen. Presentar es mostrar la slide: un chrome permanente
   * sale en la proyección y en cualquier grabación. El puntero los despierta
   * unos segundos, y quedan fijos mientras se les hace hover o tienen el foco,
   * que es lo que necesita quien va a usarlos.
   */
  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), 2200);
    };
    window.addEventListener("pointermove", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [])].filter((candidate) => !candidate.hidden);
        if (focusable.length === 0) { event.preventDefault(); dialog.current?.focus(); return; }
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); void move(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); void move(-1); }
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [close, move]);

  return (
    <div ref={dialog} className="presenter" role="dialog" aria-modal="true" aria-label={deck.name} tabIndex={-1}>
      {/* La proporción viaja como variable para que el escenario quepa entero:
          alto y ancho se limitan a la vez, sea 16:9 o cuadrado. */}
      <div
        className="presenter__stage"
        style={{
          aspectRatio: `${deck.canvas.width} / ${deck.canvas.height}`,
          ["--presenter-ratio" as string]: `${deck.canvas.width} / ${deck.canvas.height}`,
        }}
      >
        <div ref={host} className="presenter__render" />
      </div>
      {narrated && (
        <>
          <audio
            ref={audio}
            data-testid="presenter-narration-audio"
            aria-label={t("narration.audioPlayer")}
            src={deck.slides[index]?.narration?.audio
              ? assetUrls?.[deck.slides[index]!.narration!.audio!.assetId]
              : undefined}
            onEnded={narrationEnded}
          />
          {!started && (
            <button ref={startButton} type="button" className="presenter__narration-start button button--primary" onClick={startNarration}>
              <Volume2 aria-hidden="true" /> {t("narration.start")}
            </button>
          )}
          {!started && (
            <p className="presenter__narration-coverage" role="status">
              {t("narration.coverage", { count: narratedSlideCount, total: deck.slides.length })}
            </p>
          )}
          {started && narrationStatus !== "idle" && (
            <p
              className={`presenter__narration-status ${narrationStatus === "error" ? "is-error" : ""}`}
              role={narrationStatus === "error" || narrationStatus === "missing" ? "alert" : "status"}
            >
              {t(narrationStatus === "waiting"
                ? "narration.waiting"
                : narrationStatus === "playing"
                  ? "narration.playing"
                  : narrationStatus === "finished"
                    ? "narration.finished"
                    : narrationStatus === "missing"
                      ? "narration.missing"
                      : "narration.error.playback")}
            </p>
          )}
        </>
      )}
      <nav className={`presenter__controls ${awake ? "is-awake" : ""}`} aria-label={t("editor.present")}>
        <button type="button" aria-label={t("editor.previousSlide")} disabled={index === 0} onClick={() => void move(-1)}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <span aria-live="polite">{index + 1} / {deck.slides.length}</span>
        <button
          type="button"
          aria-label={t("editor.nextSlide")}
          disabled={index === deck.slides.length - 1}
          onClick={() => void move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("editor.exit")} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
