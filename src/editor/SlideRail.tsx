import { useState, type ReactNode } from "react";
import { Copy, Frame, GripVertical, Trash2 } from "lucide-react";
import type { DeksDocument } from "@deks-js/document";
import { SlideThumbnail } from "./SlideThumbnail";
import { IconButton } from "../ui/IconButton";
import type { Translate } from "../i18n";

export interface SlideRailProps {
  t: Translate;
  document: DeksDocument;
  activeSlideId: string;
  disabled?: boolean;
  assetUrls?: Record<string, string>;
  onSelect(slideId: string): void;
  onCreate(): void;
  onDuplicate(): void;
  onDelete(): void;
  onReorder(slideIds: string[]): void;
  onOpenMenu(slideId: string, point: { x: number; y: number }): void;
  /** Al pie del panel: el movimiento pertenece al borde entre dos slides. */
  footer?: ReactNode;
}

export function SlideRail({
  t,
  document: deck,
  activeSlideId,
  disabled = false,
  assetUrls,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onReorder,
  onOpenMenu,
  footer,
}: SlideRailProps) {
  const [dragged, setDragged] = useState<number>();

  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= deck.slides.length) return;
    const ids = deck.slides.map((slide) => slide.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    onReorder(ids);
  };

  return (
    <aside className="rail" aria-label={t("editor.slides")}>
      <header className="rail__head">
        <span>{t("editor.slides")}</span>
        <div>
          <IconButton label={t("editor.newSlide")} disabled={disabled} onClick={onCreate}><Frame aria-hidden="true" /></IconButton>
          <IconButton label={t("editor.duplicateSlide")} disabled={disabled} onClick={onDuplicate}><Copy aria-hidden="true" /></IconButton>
          <IconButton
            label={t("editor.deleteSlide")}
            disabled={disabled || deck.slides.length <= 1}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      </header>

      <ol className="rail__list">
        {deck.slides.map((slide, index) => (
          <li
            key={slide.id}
            className={`rail__item ${dragged === index ? "is-dragging" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== undefined) reorder(dragged, index);
              setDragged(undefined);
            }}
          >
            <button
              type="button"
              className={`rail__slide ${slide.id === activeSlideId ? "is-active" : ""}`}
              aria-current={slide.id === activeSlideId}
              aria-label={t("editor.slideNumber", { number: index + 1, name: slide.name })}
              onClick={() => onSelect(slide.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                onSelect(slide.id);
                onOpenMenu(slide.id, { x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (!(event.shiftKey && event.key === "F10") && event.key !== "ContextMenu") return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onSelect(slide.id);
                onOpenMenu(slide.id, { x: rect.right - 12, y: rect.top + 12 });
              }}
            >
              <span className="rail__index">{String(index + 1).padStart(2, "0")}</span>
              <SlideThumbnail document={deck} slideId={slide.id} assetUrls={assetUrls} className="rail__thumb" />
              <span className="rail__name">{slide.name}</span>
            </button>

            {/* Arrastrar es lo natural con el puntero, pero el orden de las
                slides es estructura del documento: también se mueve con el
                teclado desde la misma manija. */}
            <IconButton
              className="rail__grip"
              label={t("editor.dragSlide", { number: index + 1 })}
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(event) => {
                setDragged(index);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragged(undefined)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                event.preventDefault();
                reorder(index, index + (event.key === "ArrowUp" ? -1 : 1));
              }}
            >
              <GripVertical aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ol>

      {footer}
    </aside>
  );
}
