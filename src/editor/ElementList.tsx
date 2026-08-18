import { Circle, Image, Lock, Minus, Plus, Sparkles, Square, Type } from "lucide-react";
import type { DeksDocument } from "@deks-js/document";
import { editorElements, elementsElsewhere, type EditorElement } from "./elements";
import type { Translate } from "../i18n";

export interface ElementListProps {
  t: Translate;
  document: DeksDocument;
  slideId: string;
  selectedId?: string;
  disabled?: boolean;
  onSelect(elementId: string): void;
  onAddExisting(elementId: string, sourceSlideId: string): void;
}

/**
 * Qué hay dibujado en esta slide, en orden de pintado inverso —lo de encima
 * arriba, como se ve— y qué identidades existen en otras slides. Reaparecer un
 * elemento en vez de crear otro igual es lo que hace continuo un deck: el
 * renderer interpola entre los checkpoints de la misma identidad.
 */
export function ElementList({
  t,
  document: deck,
  slideId,
  selectedId,
  disabled = false,
  onSelect,
  onAddExisting,
}: ElementListProps) {
  const present = [...editorElements(deck, slideId)].reverse();
  const elsewhere = elementsElsewhere(deck, slideId);

  return (
    <div className="element-list">
      <section>
        <h3>{t("editor.elementsInSlide")}</h3>
        {present.length === 0 ? (
          <p className="element-list__empty">{t("editor.elementsEmpty")}</p>
        ) : (
          <ul>
            {present.map((element) => (
              <li key={element.id}>
                <button
                  type="button"
                  className={element.id === selectedId ? "is-selected" : ""}
                  aria-label={t("editor.selectElement", { name: element.name })}
                  aria-current={element.id === selectedId}
                  onClick={() => onSelect(element.id)}
                >
                  <KindIcon element={element} />
                  <span className="element-list__name">{element.name}</span>
                  {element.isLocked && <Lock className="element-list__lock" aria-label={t("editor.locked")} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>{t("editor.elementsElsewhere")}</h3>
        {elsewhere.length === 0 ? (
          <p className="element-list__empty">{t("editor.elementsElsewhereEmpty")}</p>
        ) : (
          <ul>
            {elsewhere.map(({ element, sourceSlideId }) => (
              <li key={element.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t("editor.addToSlide", { name: element.name })}
                  onClick={() => onAddExisting(element.id, sourceSlideId)}
                >
                  <KindIcon element={element} />
                  <span className="element-list__name">{element.name}</span>
                  <Plus className="element-list__add" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KindIcon({ element }: { element: EditorElement }) {
  const Icon = element.kind === "text"
    ? Type
    : element.kind === "image"
      ? Image
      : element.kind === "icon"
        ? Sparkles
        : element.shapeKind === "ellipse"
          ? Circle
          : element.shapeKind === "line"
            ? Minus
            : Square;
  return <Icon className="element-list__kind" aria-hidden="true" />;
}
