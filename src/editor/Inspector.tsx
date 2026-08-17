import type { DeksDocument, DeksElementState, DeksSlide } from "@deks-js/document";
import { clampOpacity, type EditorElement } from "./elements";
import type { Translate } from "../i18n";

export interface InspectorProps {
  t: Translate;
  document: DeksDocument;
  slide: DeksSlide;
  selected?: EditorElement;
  disabled?: boolean;
  onRenameSlide(name: string): void;
  onSlideBackground(color: string): void;
  onRenameElement(name: string): void;
  onPatchState(patch: Partial<Omit<DeksElementState, "elementId">>): void;
  onRemoveFromSlide(): void;
  onDeleteEverywhere(): void;
}

const ICONS = [
  "bot", "building-2", "cloud", "database", "eye", "file-text", "laptop",
  "lock-keyhole", "network", "plug", "shield-check", "triangle-alert",
  "user-round", "workflow",
];

export function Inspector({
  t,
  document: deck,
  slide,
  selected,
  disabled = false,
  onRenameSlide,
  onSlideBackground,
  onRenameElement,
  onPatchState,
  onRemoveFromSlide,
  onDeleteEverywhere,
}: InspectorProps) {
  const number = (
    label: string,
    value: number,
    key: keyof DeksElementState,
    step = 1,
  ) => (
    <label className="field field--compact">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onPatchState({ [key]: parsed } as Partial<DeksElementState>);
        }}
      />
    </label>
  );

  return (
    <aside className="inspector" aria-label={t("editor.inspector")}>
      <section>
        <h2>{t("editor.slideProperties")}</h2>
        <label className="field">
          <span>{t("editor.slideName")}</span>
          <input
            value={slide.name}
            disabled={disabled}
            aria-label={t("editor.slideName")}
            onChange={(event) => onRenameSlide(event.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("editor.background")}</span>
          <input
            type="color"
            disabled={disabled}
            aria-label={t("editor.background")}
            value={slide.background.kind === "solid" ? slide.background.color : deck.palette.background}
            onChange={(event) => onSlideBackground(event.target.value)}
          />
        </label>
      </section>

      {selected ? (
        <section>
          <h2>{t("editor.element")}</h2>
          <label className="field">
            <span>{t("editor.elementName")}</span>
            <input
              value={selected.name}
              disabled={disabled}
              aria-label={t("editor.elementName")}
              onChange={(event) => onRenameElement(event.target.value)}
            />
          </label>
          <div className="field-grid">
            {number("X", selected.x, "x")}
            {number("Y", selected.y, "y")}
            {number(t("editor.width"), selected.width, "width")}
            {number(t("editor.height"), selected.height, "height")}
            {number(t("editor.rotation"), selected.rotationDeg, "rotationDeg")}
            <label className="field field--compact">
              <span>{t("editor.opacity")}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={selected.opacity}
                disabled={disabled}
                aria-label={t("editor.opacity")}
                onChange={(event) => {
                  const parsed = Number(event.target.value);
                  if (Number.isFinite(parsed)) onPatchState({ opacity: clampOpacity(parsed) });
                }}
              />
            </label>
          </div>

          {selected.kind === "text" && (
            <>
              <label className="field">
                <span>{t("editor.content")}</span>
                <textarea
                  rows={3}
                  value={selected.content ?? ""}
                  disabled={disabled}
                  aria-label={t("editor.content")}
                  onChange={(event) => onPatchState({ content: event.target.value })}
                />
              </label>
              <div className="field-grid">
                {number(t("editor.fontSize"), selected.fontSize ?? 48, "fontSize")}
                <label className="field field--compact">
                  <span>{t("editor.color")}</span>
                  <input
                    type="color"
                    disabled={disabled}
                    aria-label={t("editor.color")}
                    value={selected.fill ?? deck.palette.text}
                    onChange={(event) => onPatchState({ fill: event.target.value })}
                  />
                </label>
              </div>
            </>
          )}

          {selected.kind === "shape" && selected.shapeKind !== "line" && (
            <label className="field">
              <span>{t("editor.fill")}</span>
              <input
                type="color"
                disabled={disabled}
                aria-label={t("editor.fill")}
                value={selected.shapeFill?.kind === "solid" ? selected.shapeFill.color : deck.palette.primary}
                onChange={(event) => onPatchState({ shapeFill: { kind: "solid", color: event.target.value } })}
              />
            </label>
          )}

          {selected.kind === "icon" && (
            <div className="field-grid">
              <label className="field">
                <span>{t("editor.icon")}</span>
                <select
                  value={selected.iconName ?? "shield-check"}
                  disabled={disabled}
                  aria-label={t("editor.icon")}
                  onChange={(event) => onPatchState({ iconName: event.target.value })}
                >
                  {ICONS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="field field--compact">
                <span>{t("editor.color")}</span>
                <input
                  type="color"
                  disabled={disabled}
                  aria-label={t("editor.color")}
                  value={selected.fill ?? deck.palette.secondary}
                  onChange={(event) => onPatchState({ fill: event.target.value })}
                />
              </label>
            </div>
          )}

          {/* Quitar de la slide y borrar de la presentación son distintas: la
              identidad puede seguir viva en otros checkpoints. */}
          <div className="inspector__actions">
            <button type="button" disabled={disabled} onClick={onRemoveFromSlide}>
              {t("editor.removeFromSlide")}
            </button>
            <button type="button" className="is-danger" disabled={disabled} onClick={onDeleteEverywhere}>
              {t("editor.deleteEverywhere")}
            </button>
          </div>
        </section>
      ) : (
        <p className="inspector__empty">{t("editor.noSelection")}</p>
      )}
    </aside>
  );
}
