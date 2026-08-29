import { useState, type FormEvent } from "react";
import { Circle, Diamond, Folder, Image, Lock, Minus, Plus, Sparkles, Square, Type } from "lucide-react";
import type { DeksDocument, DeksElement } from "@deks-js/document";
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
  onCreateGroup(name: string): Promise<boolean>;
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
  onCreateGroup,
}: ElementListProps) {
  const [groupName, setGroupName] = useState("");
  const present = [...editorElements(deck, slideId)].reverse();
  const elsewhere = elementsElsewhere(deck, slideId);
  const groups = deck.elements.filter(({ kind, parentId }) => kind === "group" && parentId === undefined);

  const submitGroup = async (event: FormEvent) => {
    event.preventDefault();
    const name = groupName.trim();
    if (!selectedId || name.length === 0) return;
    if (await onCreateGroup(name)) setGroupName("");
  };

  return (
    <div className="element-list">
      <section>
        <h3>{t("editor.logicalGroups")}</h3>
        {groups.length === 0 ? (
          <p className="element-list__empty">{t("editor.logicalGroupsEmpty")}</p>
        ) : (
          <ul className="element-list__groups">
            {groups.map((group) => (
              <GroupFolder
                key={group.id}
                t={t}
                document={deck}
                group={group}
              />
            ))}
          </ul>
        )}
        {selectedId ? (
          <form className="element-list__group-form" onSubmit={submitGroup}>
            <label className="field">
              <span className="field__label">{t("editor.groupName")}</span>
              <input
                type="text"
                value={groupName}
                maxLength={200}
                disabled={disabled}
                aria-label={t("editor.groupName")}
                onChange={(event) => setGroupName(event.target.value)}
              />
            </label>
            <button type="submit" disabled={disabled || groupName.trim().length === 0}>
              <Folder aria-hidden="true" /> {t("editor.createGroupFromSelection")}
            </button>
          </form>
        ) : (
          <p className="element-list__empty">{t("editor.selectToCreateGroup")}</p>
        )}
      </section>

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

function GroupFolder({
  t,
  document: deck,
  group,
}: {
  t: Translate;
  document: DeksDocument;
  group: DeksElement;
}) {
  const children = deck.elements.filter(({ parentId }) => parentId === group.id);

  return (
    <li>
      <div className="element-list__folder" role="group" aria-label={t("editor.groupFolder", { name: group.name })}>
        <div className="element-list__folder-name">
          <Folder aria-hidden="true" />
          <span>{group.name}</span>
        </div>
        {children.length === 0 ? (
          <p className="element-list__empty">{t("editor.groupEmpty")}</p>
        ) : (
          <ul>
            {children.map((child) => {
              if (child.kind === "group") {
                return (
                  <GroupFolder
                    key={child.id}
                    t={t}
                    document={deck}
                    group={child}
                  />
                );
              }
              return (
                <li key={child.id}>
                  <div className="element-list__identity-only">
                    <KindIcon element={child} />
                    <span className="element-list__name">{child.name}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}

function KindIcon({ element }: { element: DeksElement }) {
  const Icon = element.kind === "text"
    ? Type
    : element.kind === "image"
      ? Image
      : element.kind === "icon"
        ? Sparkles
        : element.shapeKind === "diamond"
          ? Diamond
          : element.shapeKind === "ellipse"
          ? Circle
          : element.shapeKind === "line"
            ? Minus
            : Square;
  return <Icon className="element-list__kind" aria-hidden="true" />;
}
