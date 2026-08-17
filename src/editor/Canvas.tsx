import { useEffect, useRef, useState } from "react";
import { RendererCore } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";
import { editorElements, type EditorElement } from "./elements";
import type { Translate } from "../i18n";

export interface CanvasProps {
  t: Translate;
  document: DeksDocument;
  slideId: string;
  selectedId?: string;
  disabled?: boolean;
  /** URLs efímeras por asset; el documento sólo guarda identidades. */
  assetUrls?: Record<string, string>;
  onSelect(elementId: string | undefined): void;
  /** Confirma geometría al soltar. Arrastrar no escribe en disco por frame. */
  onCommitGeometry(elementId: string, patch: Pick<EditorElement, "x" | "y" | "width" | "height">): void;
}

interface Drag {
  elementId: string;
  mode: "move" | "resize";
  originX: number;
  originY: number;
  start: Pick<EditorElement, "x" | "y" | "width" | "height">;
}

/**
 * El dibujo es de Core: `RendererCore` monta el escenario y usa geometría
 * relativa al lienzo, así que basta con darle una caja con la proporción
 * correcta. Encima va una capa de interacción propia del escritorio, en los
 * mismos porcentajes, que nunca dibuja contenido: sólo selección y manijas.
 */
export function Canvas({
  t,
  document: deck,
  slideId,
  selectedId,
  disabled = false,
  assetUrls,
  onSelect,
  onCommitGeometry,
}: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const [drag, setDrag] = useState<Drag>();
  const [preview, setPreview] = useState<Record<string, Drag["start"]>>({});
  const elements = editorElements(deck, slideId);
  const { width, height } = deck.canvas;

  const assets = useRef(assetUrls);
  assets.current = assetUrls;

  useEffect(() => {
    if (!host.current) return;
    // El resolvedor lee de un ref: cambiar de asset no puede remontar el
    // renderer, porque eso cancelaría cualquier animación en curso.
    const instance = new RendererCore({
      respectReducedMotion: true,
      assetResolver: ({ assetId }) => (assetId ? assets.current?.[assetId] : undefined),
    });
    instance.mount(host.current);
    instance.setViewportMode("editor");
    renderer.current = instance;
    return () => {
      instance.destroy();
      renderer.current = undefined;
    };
  }, []);

  // Redibuja sólo cuando cambia el documento o la slide: volver a renderizar en
  // cada render cancelaría cualquier animación en curso.
  useEffect(() => {
    renderer.current?.renderSlide(deck, slideId);
  }, [deck, slideId, assetUrls]);

  const beginDrag = (event: React.PointerEvent, element: EditorElement, mode: Drag["mode"]) => {
    if (disabled || element.isLocked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect(element.id);
    setDrag({
      elementId: element.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      start: { x: element.x, y: element.y, width: element.width, height: element.height },
    });
  };

  const move = (event: React.PointerEvent) => {
    if (!drag || !host.current) return;
    const bounds = host.current.getBoundingClientRect();
    if (bounds.width === 0) return;
    // El puntero se mueve en píxeles de pantalla; el documento vive en unidades
    // de lienzo. La escala del escenario es la única traducción entre ambos.
    const scale = width / bounds.width;
    const deltaX = (event.clientX - drag.originX) * scale;
    const deltaY = (event.clientY - drag.originY) * scale;
    const next = drag.mode === "move"
      ? { ...drag.start, x: Math.round(drag.start.x + deltaX), y: Math.round(drag.start.y + deltaY) }
      : {
          ...drag.start,
          width: Math.max(8, Math.round(drag.start.width + deltaX)),
          height: Math.max(8, Math.round(drag.start.height + deltaY)),
        };
    setPreview({ [drag.elementId]: next });
  };

  const end = () => {
    if (!drag) return;
    const next = preview[drag.elementId];
    setDrag(undefined);
    setPreview({});
    // Una sola escritura por gesto, y ninguna si el elemento no se movió.
    if (!next) return;
    const { start } = drag;
    if (next.x === start.x && next.y === start.y && next.width === start.width && next.height === start.height) return;
    onCommitGeometry(drag.elementId, next);
  };

  const percent = (element: EditorElement) => {
    const shown = { ...element, ...preview[element.id] };
    return {
      left: `${(shown.x / width) * 100}%`,
      top: `${(shown.y / height) * 100}%`,
      width: `${(shown.width / width) * 100}%`,
      height: `${(shown.height / height) * 100}%`,
      transform: `rotate(${shown.rotationDeg}deg)`,
    };
  };

  return (
    <div className="canvas-viewport">
      <div
        className="canvas-stage"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="canvas-render" ref={host} aria-hidden="true" />
        <div className="canvas-overlay" onPointerDown={() => onSelect(undefined)}>
          {elements.map((element) => (
            <div
              key={element.id}
              role="button"
              tabIndex={0}
              aria-label={element.name}
              aria-pressed={element.id === selectedId}
              className={`canvas-target ${element.id === selectedId ? "is-selected" : ""} ${element.isLocked ? "is-locked" : ""}`}
              style={percent(element)}
              onPointerDown={(event) => beginDrag(event, element, "move")}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(element.id);
              }}
            >
              {element.id === selectedId && !element.isLocked && (
                <button
                  type="button"
                  className="canvas-handle"
                  aria-label={t("editor.resize", { name: element.name })}
                  onPointerDown={(event) => beginDrag(event, element, "resize")}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
