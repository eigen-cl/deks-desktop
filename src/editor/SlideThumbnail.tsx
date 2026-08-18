import { useEffect, useRef, useState } from "react";
import { RendererCore } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";
import { backgroundCss } from "../model";

export interface SlideThumbnailProps {
  document: DeksDocument;
  slideId: string;
  assetUrls?: Record<string, string>;
  className?: string;
}

/**
 * Miniatura dibujada con el mismo renderer que el lienzo, no con un rectángulo
 * de color: el panel de slides sirve para reconocer una slide de un vistazo, y
 * el fondo solo no la distingue de las otras nueve del mismo deck.
 *
 * Se monta cuando entra en pantalla. Un deck largo no puede pagar por
 * adelantado el dibujo de cuarenta slides que nadie ha mirado todavía.
 */
export function SlideThumbnail({ document: deck, slideId, assetUrls, className = "" }: SlideThumbnailProps) {
  const root = useRef<HTMLSpanElement>(null);
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const assets = useRef(assetUrls);
  assets.current = assetUrls;

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !host.current) return;
    const renderer = new RendererCore({
      respectReducedMotion: true,
      assetResolver: ({ assetId }) => (assetId ? assets.current?.[assetId] : undefined),
    });
    try {
      renderer.mount(host.current);
      renderer.renderSlide(deck, slideId);
      setFailed(false);
    } catch {
      // Una slide que el renderer rechaza no puede dejar el panel en blanco:
      // la miniatura cae al fondo plano y el resto del editor sigue en pie.
      renderer.destroy();
      host.current?.replaceChildren();
      setFailed(true);
      return;
    }
    return () => renderer.destroy();
  }, [deck, slideId, visible, assetUrls]);

  const slide = deck.slides.find(({ id }) => id === slideId);
  return (
    <span
      ref={root}
      className={`thumbnail ${className}`}
      aria-hidden="true"
      style={{
        aspectRatio: `${deck.canvas.width} / ${deck.canvas.height}`,
        background: backgroundCss(slide?.background),
      }}
    >
      {!failed && <span ref={host} className="thumbnail__render" />}
    </span>
  );
}
