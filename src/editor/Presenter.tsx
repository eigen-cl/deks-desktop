import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { RendererCore } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";
import type { Translate } from "../i18n";

export interface PresenterProps {
  t: Translate;
  document: DeksDocument;
  initialSlideId: string;
  /** URLs efímeras por asset: sin ellas una imagen no se ve al presentar. */
  assetUrls?: Record<string, string>;
  onClose(): void;
}

/**
 * Reproduce el deck con el mismo motor que dibuja el editor, así que una
 * transición se ve aquí igual que en la web. Core resuelve la arista desde el
 * documento; el escritorio sólo decide cuándo avanzar.
 */
export function Presenter({ t, document: deck, initialSlideId, assetUrls, onClose }: PresenterProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const moving = useRef(false);
  const [awake, setAwake] = useState(false);
  const assets = useRef(assetUrls);
  assets.current = assetUrls;
  const [index, setIndex] = useState(() => {
    const found = deck.slides.findIndex(({ id }) => id === initialSlideId);
    return found < 0 ? 0 : found;
  });

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
      instance.destroy();
      renderer.current = undefined;
    };
    // Se monta una vez: avanzar es reproducir, no volver a montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback(async (direction: -1 | 1) => {
    const target = index + direction;
    if (moving.current || target < 0 || target >= deck.slides.length) return;
    moving.current = true;
    try {
      const from = deck.slides[index]!.id;
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
      setIndex(target);
    } finally {
      moving.current = false;
    }
  }, [deck, index]);

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
      if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); void move(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); void move(-1); }
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [move, onClose]);

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label={deck.name}>
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
        <button type="button" aria-label={t("editor.exit")} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
