import { Copy, Frame, Trash2 } from "lucide-react";
import type { DeksDocument } from "@deks-js/document";
import { backgroundCss } from "../model";
import type { Translate } from "../i18n";

export interface SlideRailProps {
  t: Translate;
  document: DeksDocument;
  activeSlideId: string;
  disabled?: boolean;
  onSelect(slideId: string): void;
  onCreate(): void;
  onDuplicate(): void;
  onDelete(): void;
  onReorder(slideIds: string[]): void;
}

export function SlideRail({
  t,
  document: deck,
  activeSlideId,
  disabled = false,
  onSelect,
  onCreate,
  onDuplicate,
  onDelete,
  onReorder,
}: SlideRailProps) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= deck.slides.length) return;
    const ids = deck.slides.map((slide) => slide.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(target, 0, moved!);
    onReorder(ids);
  };

  return (
    <aside className="rail" aria-label={t("editor.slides")}>
      <header className="rail__head">
        <span>{t("editor.slides")}</span>
        <div>
          <button type="button" disabled={disabled} aria-label={t("editor.newSlide")} onClick={onCreate}>
            <Frame aria-hidden="true" />
          </button>
          <button type="button" disabled={disabled} aria-label={t("editor.duplicateSlide")} onClick={onDuplicate}>
            <Copy aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={disabled || deck.slides.length <= 1}
            aria-label={t("editor.deleteSlide")}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>
      <ol className="rail__list">
        {deck.slides.map((slide, index) => (
          <li key={slide.id}>
            <button
              type="button"
              className={`rail__slide ${slide.id === activeSlideId ? "is-active" : ""}`}
              aria-current={slide.id === activeSlideId}
              aria-label={t("editor.slideNumber", { number: index + 1, name: slide.name })}
              onClick={() => onSelect(slide.id)}
            >
              <span className="rail__index">{String(index + 1).padStart(2, "0")}</span>
              <span
                className="rail__thumb"
                aria-hidden="true"
                style={{
                  background: backgroundCss(slide.background),
                  aspectRatio: `${deck.canvas.width} / ${deck.canvas.height}`,
                }}
              />
              <span className="rail__name">{slide.name}</span>
            </button>
            {/* Reordenar por teclado y no sólo arrastrando: el orden de las
                slides es estructura del documento, no un adorno del panel. */}
            <span className="rail__move">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={t("editor.moveSlideUp", { number: index + 1 })}
                onClick={() => move(index, -1)}
              >↑</button>
              <button
                type="button"
                disabled={disabled || index === deck.slides.length - 1}
                aria-label={t("editor.moveSlideDown", { number: index + 1 })}
                onClick={() => move(index, 1)}
              >↓</button>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
