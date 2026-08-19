import type { DeksDocument, DeksElementState, DeksSlide, SlideBackground } from "@deks-js/document";
import { Lock, LockOpen, Trash2 } from "lucide-react";
import { clampOpacity, type EditorElement } from "./elements";
import { ElementList } from "./ElementList";
import { ColorField, NumberField, SelectField, TextAreaField, TextField, Toggle } from "../ui/fields";
import type { Translate } from "../i18n";

export type InspectorTab = "slide" | "element" | "elements";

export interface InspectorProps {
  t: Translate;
  document: DeksDocument;
  slide: DeksSlide;
  selected?: EditorElement;
  disabled?: boolean;
  tab: InspectorTab;
  onTabChange(tab: InspectorTab): void;
  onSelectElement(elementId: string): void;
  onAddExisting(elementId: string, sourceSlideId: string): void;
  onPatchSlide(patch: Partial<Omit<DeksSlide, "id" | "states">>): void;
  onRenameElement(name: string): void;
  onLockElement(isLocked: boolean): void;
  onAnimateMagnitude(animateMagnitude: { in: boolean; morph: boolean; out: boolean }): void;
  onPatchState(patch: Partial<Omit<DeksElementState, "elementId">>): void;
  onRemoveFromSlide(): void;
  onDeleteEverywhere(): void;
}

const ICONS = [
  "bot", "building-2", "cloud", "database", "eye", "file-text", "laptop",
  "lock-keyhole", "network", "plug", "shield-check", "triangle-alert",
  "user-round", "workflow",
];

const TABS: InspectorTab[] = ["slide", "element", "elements"];

/**
 * Panel derecho. Sus tres vistas —la slide, el elemento y el inventario— viven
 * en pestañas y no apiladas: apiladas, el elemento seleccionado quedaba bajo el
 * pliegue y el panel se desplazaba entero cada vez que se elegía otra cosa.
 * El desplazamiento pertenece sólo al contenido, así que las pestañas y el
 * encabezado no se van de la vista.
 */
export function Inspector({
  t,
  document: deck,
  slide,
  selected,
  disabled = false,
  tab,
  onTabChange,
  onSelectElement,
  onAddExisting,
  onPatchSlide,
  onRenameElement,
  onLockElement,
  onAnimateMagnitude,
  onPatchState,
  onRemoveFromSlide,
  onDeleteEverywhere,
}: InspectorProps) {
  // La pestaña lleva el nombre corto: «Propiedades de slide» se partía en dos
  // líneas y empujaba el panel. El título largo sigue en el encabezado.
  const label: Record<InspectorTab, string> = {
    slide: t("editor.tabSlide"),
    element: t("editor.element"),
    elements: t("editor.elements"),
  };

  return (
    <aside className="inspector" aria-label={t("editor.inspector")}>
      <div className="inspector__tabs" role="tablist" aria-label={t("editor.inspector")}>
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`inspector-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="inspector-panel"
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? "is-active" : ""}
            onClick={() => onTabChange(value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const index = TABS.indexOf(tab);
              const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
              onTabChange(next);
              document.getElementById(`inspector-tab-${next}`)?.focus();
            }}
          >
            {label[value]}
          </button>
        ))}
      </div>

      <div
        className="inspector__scroll"
        id="inspector-panel"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "slide" && <SlideProperties t={t} deck={deck} slide={slide} disabled={disabled} onPatch={onPatchSlide} />}
        {tab === "element" && (selected
          ? (
            <ElementProperties
              t={t}
              deck={deck}
              element={selected}
              disabled={disabled}
              onRename={onRenameElement}
              onLock={onLockElement}
              onAnimateMagnitude={onAnimateMagnitude}
              onPatch={onPatchState}
              onRemoveFromSlide={onRemoveFromSlide}
              onDeleteEverywhere={onDeleteEverywhere}
            />
          )
          : <p className="inspector__empty">{t("editor.noSelection")}</p>)}
        {tab === "elements" && (
          <ElementList
            t={t}
            document={deck}
            slideId={slide.id}
            selectedId={selected?.id}
            disabled={disabled}
            onSelect={onSelectElement}
            onAddExisting={onAddExisting}
          />
        )}
      </div>
    </aside>
  );
}

function SlideProperties({
  t,
  deck,
  slide,
  disabled,
  onPatch,
}: {
  t: Translate;
  deck: DeksDocument;
  slide: DeksSlide;
  disabled: boolean;
  onPatch(patch: Partial<Omit<DeksSlide, "id" | "states">>): void;
}) {
  const background = slide.background;
  const changeKind = (kind: string) => {
    // Cambiar de tipo conserva el color que ya se veía: pasar a gradiente no
    // puede estrenar dos colores que nadie eligió.
    const next: SlideBackground = kind === "linear-gradient"
      ? {
          kind: "linear-gradient",
          startColor: background.kind === "solid" ? background.color : background.startColor,
          endColor: background.kind === "linear-gradient" ? background.endColor : deck.palette.accent,
          angleDeg: background.kind === "linear-gradient" ? background.angleDeg : 135,
        }
      : { kind: "solid", color: background.kind === "solid" ? background.color : background.startColor };
    onPatch({ background: next });
  };

  return (
    <section className="panel">
      <h3>{t("editor.slideProperties")}</h3>
      <TextField
        label={t("editor.slideName")}
        value={slide.name}
        disabled={disabled}
        onChange={(name) => onPatch({ name })}
      />
      <SelectField
        label={t("editor.backgroundKind")}
        value={background.kind}
        disabled={disabled}
        options={[
          { value: "solid", label: t("editor.solid") },
          { value: "linear-gradient", label: t("editor.gradient") },
        ]}
        onValueChange={changeKind}
      />
      {background.kind === "solid" ? (
        <ColorField
          label={t("editor.background")}
          value={background.color}
          disabled={disabled}
          onCommit={(color) => onPatch({ background: { kind: "solid", color } })}
        />
      ) : (
        <>
          <div className="panel__grid">
            <ColorField
              label={t("editor.gradientStart")}
              value={background.startColor}
              disabled={disabled}
              onCommit={(startColor) => onPatch({ background: { ...background, startColor } })}
            />
            <ColorField
              label={t("editor.gradientEnd")}
              value={background.endColor}
              disabled={disabled}
              onCommit={(endColor) => onPatch({ background: { ...background, endColor } })}
            />
          </div>
          <NumberField
            label={t("editor.gradientAngle")}
            value={background.angleDeg}
            disabled={disabled}
            onCommit={(angleDeg) => onPatch({ background: { ...background, angleDeg } })}
          />
        </>
      )}
    </section>
  );
}

function ElementProperties({
  t,
  deck,
  element,
  disabled,
  onRename,
  onLock,
  onAnimateMagnitude,
  onPatch,
  onRemoveFromSlide,
  onDeleteEverywhere,
}: {
  t: Translate;
  deck: DeksDocument;
  element: EditorElement;
  disabled: boolean;
  onRename(name: string): void;
  onLock(isLocked: boolean): void;
  /** Los toggles de conteo viven en la identidad, no en el estado de la slide. */
  onAnimateMagnitude(animateMagnitude: { in: boolean; morph: boolean; out: boolean }): void;
  onPatch(patch: Partial<Omit<DeksElementState, "elementId">>): void;
  onRemoveFromSlide(): void;
  onDeleteEverywhere(): void;
}) {
  const fill = element.shapeFill ?? { kind: "solid" as const, color: deck.palette.primary };
  const corner = element.cornerRadii?.topLeft ?? element.cornerRadius ?? 0;

  return (
    <>
      <section className="panel">
        <TextField label={t("editor.elementName")} value={element.name} disabled={disabled} onChange={onRename} />
        <button
          type="button"
          className="panel__inline-action"
          disabled={disabled}
          onClick={() => onLock(!element.isLocked)}
        >
          {element.isLocked ? <LockOpen aria-hidden="true" /> : <Lock aria-hidden="true" />}
          {element.isLocked ? t("editor.unlock") : t("editor.lock")}
        </button>
      </section>

      <section className="panel">
        <h3>{t("editor.geometry")}</h3>
        <div className="panel__grid">
          <NumberField label="X" short="X" value={element.x} disabled={disabled} onCommit={(x) => onPatch({ x })} />
          <NumberField label="Y" short="Y" value={element.y} disabled={disabled} onCommit={(y) => onPatch({ y })} />
          <NumberField label={t("editor.width")} short="W" value={element.width} min={1} disabled={disabled} onCommit={(width) => onPatch({ width })} />
          <NumberField label={t("editor.height")} short="H" value={element.height} min={1} disabled={disabled} onCommit={(height) => onPatch({ height })} />
        </div>
        <div className="panel__grid">
          <NumberField label={t("editor.rotation")} value={element.rotationDeg} step={1} disabled={disabled} onCommit={(rotationDeg) => onPatch({ rotationDeg })} />
          <NumberField
            label={t("editor.opacity")}
            value={element.opacity}
            min={0}
            max={1}
            step={0.05}
            disabled={disabled}
            onCommit={(opacity) => onPatch({ opacity: clampOpacity(opacity) })}
          />
          <NumberField label={t("editor.zIndex")} value={element.zIndex} step={1} disabled={disabled} onCommit={(zIndex) => onPatch({ zIndex })} />
        </div>
      </section>

      {element.kind === "text" && (
        <section className="panel">
          <h3>{t("editor.addText")}</h3>
          <TextAreaField label={t("editor.content")} value={element.content ?? ""} disabled={disabled} onChange={(content) => onPatch({ content })} />
          <SelectField
            label={t("editor.fontFamily")}
            value={element.fontFamily ?? "Poppins"}
            disabled={disabled}
            options={[{ value: "Poppins", label: "Poppins" }, { value: "Roboto", label: "Roboto" }]}
            onValueChange={(fontFamily) => onPatch({ fontFamily: fontFamily as "Poppins" | "Roboto" })}
          />
          <div className="panel__grid">
            <NumberField label={t("editor.fontSize")} value={element.fontSize ?? 48} min={1} disabled={disabled} onCommit={(fontSize) => onPatch({ fontSize })} />
            <NumberField label={t("editor.fontWeight")} value={element.fontWeight ?? 600} min={100} max={900} step={100} disabled={disabled} onCommit={(fontWeight) => onPatch({ fontWeight })} />
            <NumberField label={t("editor.lineHeight")} value={element.lineHeight ?? 1.15} min={0.5} step={0.05} disabled={disabled} onCommit={(lineHeight) => onPatch({ lineHeight })} />
            <NumberField label={t("editor.letterSpacing")} value={element.letterSpacing ?? 0} step={0.5} disabled={disabled} onCommit={(letterSpacing) => onPatch({ letterSpacing })} />
          </div>
          <SelectField
            label={t("editor.align")}
            value={element.horizontalAlignment ?? "left"}
            disabled={disabled}
            options={[
              { value: "left", label: t("editor.alignLeft") },
              { value: "center", label: t("editor.alignCenter") },
              { value: "right", label: t("editor.alignRight") },
              { value: "justify", label: t("editor.alignJustify") },
            ]}
            onValueChange={(value) => onPatch({ horizontalAlignment: value as DeksElementState["horizontalAlignment"] })}
          />
          <SelectField
            label={t("editor.verticalAlign")}
            value={element.verticalAlignment ?? "middle"}
            disabled={disabled}
            options={[
              { value: "top", label: t("editor.alignTop") },
              { value: "middle", label: t("editor.alignMiddle") },
              { value: "bottom", label: t("editor.alignBottom") },
            ]}
            onValueChange={(value) => onPatch({ verticalAlignment: value as DeksElementState["verticalAlignment"] })}
          />
          <SelectField
            label={t("editor.overflow")}
            value={element.overflowMode ?? "hidden"}
            disabled={disabled}
            options={[
              { value: "visible", label: t("editor.overflowVisible") },
              { value: "hidden", label: t("editor.overflowHidden") },
              { value: "clip", label: t("editor.overflowClip") },
            ]}
            onValueChange={(value) => onPatch({ overflowMode: value as DeksElementState["overflowMode"] })}
          />
          <ColorField label={t("editor.color")} value={element.fill ?? deck.palette.text} disabled={disabled} onCommit={(value) => onPatch({ fill: value })} />
        </section>
      )}

      {element.kind === "shape" && (
        <section className="panel">
          <h3>{t("editor.fill")}</h3>
          {element.shapeKind !== "line" && (
            <>
              <SelectField
                label={t("editor.backgroundKind")}
                value={fill.kind}
                disabled={disabled}
                options={[
                  { value: "solid", label: t("editor.solid") },
                  { value: "linear-gradient", label: t("editor.gradient") },
                ]}
                onValueChange={(kind) =>
                  onPatch({
                    shapeFill: kind === "linear-gradient"
                      ? {
                          kind: "linear-gradient",
                          startColor: fill.kind === "solid" ? fill.color : fill.startColor,
                          endColor: fill.kind === "linear-gradient" ? fill.endColor : deck.palette.accent,
                          angleDeg: fill.kind === "linear-gradient" ? fill.angleDeg : 90,
                        }
                      : { kind: "solid", color: fill.kind === "solid" ? fill.color : fill.startColor },
                  })}
              />
              {fill.kind === "solid" ? (
                <ColorField label={t("editor.fill")} value={fill.color} disabled={disabled} onCommit={(color) => onPatch({ shapeFill: { kind: "solid", color } })} />
              ) : (
                <>
                  <div className="panel__grid">
                    <ColorField label={t("editor.gradientStart")} value={fill.startColor} disabled={disabled} onCommit={(startColor) => onPatch({ shapeFill: { ...fill, startColor } })} />
                    <ColorField label={t("editor.gradientEnd")} value={fill.endColor} disabled={disabled} onCommit={(endColor) => onPatch({ shapeFill: { ...fill, endColor } })} />
                  </div>
                  <NumberField label={t("editor.gradientAngle")} value={fill.angleDeg} disabled={disabled} onCommit={(angleDeg) => onPatch({ shapeFill: { ...fill, angleDeg } })} />
                </>
              )}
            </>
          )}
          <ColorField
            label={element.shapeKind === "line" ? t("editor.lineColor") : t("editor.stroke")}
            value={element.stroke ?? deck.palette.primary}
            disabled={disabled}
            onCommit={(stroke) => onPatch({ stroke })}
          />
          <div className="panel__grid">
            <NumberField label={t("editor.strokeWidth")} value={element.strokeWidth ?? 0} min={0} step={0.5} disabled={disabled} onCommit={(strokeWidth) => onPatch({ strokeWidth })} />
            {element.shapeKind === "rectangle" && (
              <NumberField
                label={t("editor.cornerRadius")}
                value={corner}
                min={0}
                disabled={disabled}
                onCommit={(radius) =>
                  onPatch({ cornerRadii: { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius } })}
              />
            )}
          </div>
        </section>
      )}

      {element.kind === "number" && (
        <section className="panel">
          <h3>{t("editor.addNumber")}</h3>
          <div className="panel__grid">
            <NumberField label={t("editor.numberValue")} value={element.value ?? 0} step={1} disabled={disabled} onCommit={(value) => onPatch({ value })} />
            <NumberField label={t("editor.numberDecimals")} value={element.decimals ?? 0} min={0} max={6} step={1} disabled={disabled} onCommit={(decimals) => onPatch({ decimals })} />
          </div>
          <div className="panel__grid">
            <TextField label={t("editor.numberSymbol")} value={element.symbol ?? ""} disabled={disabled} onChange={(symbol) => onPatch({ symbol: symbol.slice(0, 8) })} />
            <SelectField
              label={t("editor.numberSymbolPosition")}
              value={element.symbolPosition ?? "after"}
              disabled={disabled}
              options={[
                { value: "before", label: t("editor.numberSymbolBefore") },
                { value: "after", label: t("editor.numberSymbolAfter") },
              ]}
              onValueChange={(value) => onPatch({ symbolPosition: value as "before" | "after" })}
            />
          </div>
          <div className="panel__grid">
            <SelectField
              label={t("editor.numberGroupSeparator")}
              value={element.groupSeparator ?? ","}
              disabled={disabled}
              options={[
                { value: ",", label: "1,234" },
                { value: ".", label: "1.234" },
                { value: " ", label: "1 234" },
                { value: "'", label: "1'234" },
                { value: "", label: t("editor.numberNoGrouping") },
              ]}
              onValueChange={(value) => onPatch({ groupSeparator: value as "," })}
            />
            <SelectField
              label={t("editor.numberDecimalSeparator")}
              value={element.decimalSeparator ?? "."}
              disabled={disabled}
              options={[{ value: ".", label: "0.5" }, { value: ",", label: "0,5" }]}
              onValueChange={(value) => onPatch({ decimalSeparator: value as "." | "," })}
            />
          </div>
          <p className="panel__hint">{t("editor.numberMagnitudeHint")}</p>
          {(["in", "morph", "out"] as const).map((role) => (
            <Toggle
              key={role}
              label={t(`editor.numberMagnitude.${role}` as const)}
              checked={element.animateMagnitude?.[role] ?? false}
              disabled={disabled}
              onCheckedChange={(checked) => onAnimateMagnitude({
                in: element.animateMagnitude?.in ?? false,
                morph: element.animateMagnitude?.morph ?? false,
                out: element.animateMagnitude?.out ?? false,
                [role]: checked,
              })}
            />
          ))}
          <ColorField label={t("editor.color")} value={element.fill ?? deck.palette.secondary} disabled={disabled} onCommit={(value) => onPatch({ fill: value })} />
        </section>
      )}

      {element.kind === "icon" && (
        <section className="panel">
          <h3>{t("editor.icon")}</h3>
          <SelectField
            label={t("editor.icon")}
            value={element.iconName ?? "shield-check"}
            disabled={disabled}
            options={ICONS.map((name) => ({ value: name, label: name }))}
            onValueChange={(iconName) => onPatch({ iconName })}
          />
          <ColorField label={t("editor.color")} value={element.fill ?? deck.palette.secondary} disabled={disabled} onCommit={(value) => onPatch({ fill: value })} />
          <NumberField label={t("editor.strokeWidth")} value={element.strokeWidth ?? 2} min={0.5} max={8} step={0.5} disabled={disabled} onCommit={(strokeWidth) => onPatch({ strokeWidth })} />
        </section>
      )}

      {element.kind === "image" && (
        <section className="panel">
          <h3>{t("editor.addImage")}</h3>
          <TextField label={t("editor.alt")} value={element.alt ?? ""} disabled={disabled} onChange={(alt) => onPatch({ alt })} />
          <SelectField
            label={t("editor.fit")}
            value={element.fit ?? "contain"}
            disabled={disabled}
            options={[
              { value: "contain", label: t("editor.fitContain") },
              { value: "cover", label: t("editor.fitCover") },
              { value: "fill", label: t("editor.fitFill") },
            ]}
            onValueChange={(value) => onPatch({ fit: value as DeksElementState["fit"] })}
          />
        </section>
      )}

      {/* Quitar de la slide y borrar de la presentación son distintas: la
          identidad puede seguir viva en otros checkpoints. */}
      <section className="panel panel--actions">
        <button type="button" disabled={disabled} onClick={onRemoveFromSlide}>{t("editor.removeFromSlide")}</button>
        <button type="button" className="is-danger" disabled={disabled} onClick={onDeleteEverywhere}>
          <Trash2 aria-hidden="true" /> {t("editor.deleteEverywhere")}
        </button>
      </section>
    </>
  );
}
