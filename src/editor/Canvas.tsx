import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Maximize2, Minus, Plus } from "lucide-react";
import { RendererCore } from "@deks-js/renderer-core";
import type { DeksDocument } from "@deks-js/document";
import { editorElements, type EditorElement } from "./elements";
import { snapBox, type Box, type Guide } from "./snapping";
import type { EditorPreferences } from "./preferences";
import { IconButton } from "../ui/IconButton";
import type { Translate } from "../i18n";

export interface CanvasProps {
  t: Translate;
  document: DeksDocument;
  slideId: string;
  selectedId?: string;
  disabled?: boolean;
  preferences: EditorPreferences;
  /** URLs efímeras por asset; el documento sólo guarda identidades. */
  assetUrls?: Record<string, string>;
  onSelect(elementId: string | undefined): void;
  /** Confirma geometría al soltar. Arrastrar no escribe en disco por frame. */
  onCommitGeometry(elementId: string, patch: Box): void;
  onOpenMenu(elementId: string, point: { x: number; y: number }): void;
}

type Handle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
const HANDLES: Handle[] = ["nw", "n", "ne", "w", "e", "sw", "s", "se"];

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
  preferences,
  assetUrls,
  onSelect,
  onCommitGeometry,
  onOpenMenu,
}: CanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const renderer = useRef<RendererCore>();
  const [preview, setPreview] = useState<Record<string, Box>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [announcement, setAnnouncement] = useState("");
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

  /**
   * Redibuja sólo cuando cambia el documento o la slide: volver a renderizar en
   * cada render cancelaría cualquier animación en curso.
   *
   * Cambiar de slide sin editar reproduce la transición declarada, que es lo
   * que se está componiendo: un corte seco obliga a entrar al modo presentación
   * para saber si el movimiento quedó bien. Si el documento cambió en el mismo
   * paso —o las slides no son vecinas— se dibuja directo, porque animar hacia
   * un contenido recién editado mostraría un estado que ya no existe.
   */
  const shown = useRef<{ slideId: string; revision: number }>();
  useEffect(() => {
    const instance = renderer.current;
    if (!instance) return;
    const previous = shown.current;
    shown.current = { slideId, revision: deck.revision };
    const changedSlideOnly = previous !== undefined
      && previous.slideId !== slideId
      && previous.revision === deck.revision;
    if (changedSlideOnly && preferences.animateSlideChange) {
      try {
        instance.compileTransition(deck, previous.slideId, slideId);
        void instance.play();
        return;
      } catch {
        // Sin arista declarada entre esas dos slides el salto es un corte.
      }
    }
    instance.renderSlide(deck, slideId);
  }, [deck, slideId, assetUrls, preferences.animateSlideChange]);

  /**
   * Mueve el nodo ya pintado en vez de volver a dibujar la slide. Arrastrar
   * tiene que verse en el contenido real —el texto, la imagen, la forma— y no
   * sólo en el marco de selección; redibujar la slide entera por frame
   * cancelaría animaciones y parpadearía.
   */
  const paintPreview = useCallback((elementId: string, box: Box) => {
    const node = host.current?.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(elementId)}"]`);
    if (!node) return;
    node.style.left = `${(box.x / width) * 100}%`;
    node.style.top = `${(box.y / height) * 100}%`;
    node.style.width = `${(box.width / width) * 100}%`;
    node.style.height = `${(box.height / height) * 100}%`;
  }, [height, width]);

  const restore = useCallback(() => {
    renderer.current?.renderSlide(deck, slideId);
  }, [deck, slideId]);

  const begin = (event: React.PointerEvent, element: EditorElement, handle?: Handle) => {
    if (disabled || element.isLocked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(element.id);

    const start: Box = { x: element.x, y: element.y, width: element.width, height: element.height };
    const origin = { x: event.clientX, y: event.clientY };
    const bounds = stage.current?.getBoundingClientRect();
    // El puntero se mueve en píxeles de pantalla; el documento vive en unidades
    // de lienzo. La escala del escenario es la única traducción entre ambos.
    const scale = width / (bounds?.width || width);
    const others = elements.filter((candidate) => candidate.id !== element.id);
    let latest = start;
    let moved = false;
    let frame = 0;

    const move = (pointer: PointerEvent) => {
      const deltaX = (pointer.clientX - origin.x) * scale;
      const deltaY = (pointer.clientY - origin.y) * scale;
      if (!moved && Math.hypot(pointer.clientX - origin.x, pointer.clientY - origin.y) < 4) return;
      moved = true;
      const raw = handle ? resize(start, handle, deltaX, deltaY) : { ...start, x: start.x + deltaX, y: start.y + deltaY };
      // Alt suelta los imanes sin desactivar la preferencia: a veces hace falta
      // sólo por un gesto.
      const snapped = pointer.altKey
        ? { box: raw, guides: [] }
        : snapBox({
            moved: raw,
            others,
            canvas: deck.canvas,
            threshold: 6 * scale,
            mode: handle ? "resize" : "move",
            snapToGrid: preferences.snapToGrid,
            snapToElements: preferences.snapToElements,
            gridStep: preferences.gridStep,
          });
      latest = snapped.box;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        paintPreview(element.id, latest);
        setPreview({ [element.id]: latest });
        setGuides(snapped.guides);
      });
    };

    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", escape);
      setPreview({});
      setGuides([]);
    };
    const finish = () => {
      cleanup();
      if (!moved) return;
      const rounded: Box = {
        x: Math.round(latest.x),
        y: Math.round(latest.y),
        width: Math.max(1, Math.round(latest.width)),
        height: Math.max(1, Math.round(latest.height)),
      };
      // Una sola escritura por gesto, y ninguna si el elemento no se movió.
      if (rounded.x === start.x && rounded.y === start.y && rounded.width === start.width && rounded.height === start.height) {
        restore();
        return;
      }
      onCommitGeometry(element.id, rounded);
      setAnnouncement(handle
        ? t("editor.resizedAnnouncement", { name: element.name, width: rounded.width, height: rounded.height })
        : t("editor.movedAnnouncement", { name: element.name, x: rounded.x, y: rounded.y }));
    };
    const abort = () => {
      cleanup();
      restore();
      setAnnouncement(t("editor.dragCancelled"));
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key === "Escape") abort();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", abort, { once: true });
    window.addEventListener("keydown", escape);
  };

  const nudge = (element: EditorElement, event: React.KeyboardEvent, resizing = false) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (disabled || element.isLocked) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 10 : 1;
    const horizontal = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const vertical = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    const next: Box = resizing
      ? {
          x: element.x,
          y: element.y,
          width: Math.max(1, element.width + horizontal),
          height: Math.max(1, element.height + vertical),
        }
      : { x: element.x + horizontal, y: element.y + vertical, width: element.width, height: element.height };
    onCommitGeometry(element.id, next);
    setAnnouncement(resizing
      ? t("editor.resizedAnnouncement", { name: element.name, width: next.width, height: next.height })
      : t("editor.movedAnnouncement", { name: element.name, x: next.x, y: next.y }));
  };

  const beginPan = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const origin = { ...pan, x0: event.clientX, y0: event.clientY };
    const move = (pointer: PointerEvent) =>
      setPan({ x: origin.x + (pointer.clientX - origin.x0), y: origin.y + (pointer.clientY - origin.y0) });
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  const box = (element: EditorElement) => ({ ...element, ...preview[element.id] });

  return (
    <div className="canvas" ref={viewport}>
      <div className="canvas__controls">
        <IconButton label={t("editor.zoomOut")} onClick={() => setZoom((value) => Math.max(0.25, Number((value - 0.1).toFixed(2))))}>
          <Minus aria-hidden="true" />
        </IconButton>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <IconButton label={t("editor.zoomIn")} onClick={() => setZoom((value) => Math.min(4, Number((value + 0.1).toFixed(2))))}>
          <Plus aria-hidden="true" />
        </IconButton>
        <IconButton label={t("editor.zoomFit")} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
          <Maximize2 aria-hidden="true" />
        </IconButton>
        <IconButton
          label={t("editor.pan")}
          aria-pressed={panning}
          className={panning ? "is-active" : ""}
          onClick={() => setPanning((value) => !value)}
        >
          <Hand aria-hidden="true" />
        </IconButton>
      </div>

      <div
        className={`canvas__viewport ${panning ? "is-panning" : ""}`}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (panning) beginPan(event);
          else onSelect(undefined);
        }}
      >
        <div
          ref={stage}
          className="canvas__stage"
          style={{ aspectRatio: `${width} / ${height}`, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          aria-label={t("editor.canvasLabel", { width, height })}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (panning) beginPan(event);
            else onSelect(undefined);
          }}
        >
          <div className="canvas__render" ref={host} aria-hidden="true" />

          {preferences.showGrid && (
            <div
              className="canvas__grid"
              aria-hidden="true"
              style={{
                backgroundSize: `${(preferences.gridStep / width) * 100}% ${(preferences.gridStep / height) * 100}%`,
              }}
            />
          )}

          {guides.length > 0 && (
            <div className="canvas__guides" aria-hidden="true">
              {guides.map((guide, index) => (
                <i
                  key={`${guide.axis}-${guide.value}-${index}`}
                  className={`canvas__guide is-${guide.axis}`}
                  style={guide.axis === "x"
                    ? { left: `${(guide.value / width) * 100}%` }
                    : { top: `${(guide.value / height) * 100}%` }}
                />
              ))}
            </div>
          )}

          {/* La capa de interacción tapa el escenario, así que el clic en el
              vacío llega aquí: es el que tiene que soltar la selección. */}
          <div
            className="canvas__overlay"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (panning) beginPan(event);
              else onSelect(undefined);
            }}
          >
            {elements.map((element) => {
              const shown = box(element);
              const selected = element.id === selectedId;
              return (
                <div
                  key={element.id}
                  role="button"
                  tabIndex={0}
                  aria-label={element.name}
                  aria-pressed={selected}
                  className={`canvas__target ${selected ? "is-selected" : ""} ${element.isLocked ? "is-locked" : ""}`}
                  style={{
                    left: `${(shown.x / width) * 100}%`,
                    top: `${(shown.y / height) * 100}%`,
                    width: `${(shown.width / width) * 100}%`,
                    height: `${(shown.height / height) * 100}%`,
                    transform: `rotate(${element.rotationDeg}deg)`,
                  }}
                  onPointerDown={(event) => begin(event, element)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(element.id);
                      return;
                    }
                    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onSelect(element.id);
                      onOpenMenu(element.id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                      return;
                    }
                    nudge(element, event);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelect(element.id);
                    onOpenMenu(element.id, { x: event.clientX, y: event.clientY });
                  }}
                >
                  {selected && !element.isLocked && HANDLES.map((handle) => (
                    <button
                      key={handle}
                      type="button"
                      className={`canvas__handle is-${handle}`}
                      aria-label={t("editor.resize", { name: element.name })}
                      onPointerDown={(event) => begin(event, element, handle)}
                      onKeyDown={(event) => nudge(element, event, true)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </div>
  );
}

/**
 * Redimensionar desde una manija ancla el lado opuesto: tirar del borde
 * izquierdo tiene que mover `x` y no sólo el ancho, o el elemento se escaparía
 * hacia el otro lado mientras se arrastra.
 */
function resize(start: Box, handle: Handle, deltaX: number, deltaY: number): Box {
  const next = { ...start };
  if (handle.includes("e")) next.width = start.width + deltaX;
  if (handle.includes("s")) next.height = start.height + deltaY;
  if (handle.includes("w")) {
    next.width = start.width - deltaX;
    next.x = start.x + deltaX;
  }
  if (handle.includes("n")) {
    next.height = start.height - deltaY;
    next.y = start.y + deltaY;
  }
  if (next.width < 1) {
    next.width = 1;
    if (handle.includes("w")) next.x = start.x + start.width - 1;
  }
  if (next.height < 1) {
    next.height = 1;
    if (handle.includes("n")) next.y = start.y + start.height - 1;
  }
  return next;
}
