import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  effectiveDurationMs,
  resolveSlideMotion,
  type DeksDocument,
  type Easing,
  type MotionRole,
  type MotionRolePatch,
} from "@deks-js/document";
import { NumberField, SelectField } from "../ui/fields";
import type { Translate } from "../i18n";

export interface SlideMotionProps {
  t: Translate;
  document: DeksDocument;
  slideId: string;
  disabled?: boolean;
  onSet(role: MotionRole, patch: MotionRolePatch): void;
  onClear(role: MotionRole): void;
}

const ROLES: MotionRole[] = ["in", "out", "morph"];

/**
 * Movimiento de la slide, al pie del panel de slides: es una propiedad del
 * borde entre dos slides, así que vive junto a la lista que define ese orden y
 * no en el inspector del elemento seleccionado.
 *
 * Los campos siempre muestran el valor resuelto —documento ← slide— para que
 * nunca se vea un control vacío; tocar uno declara sólo esa propiedad en esta
 * slide y el resto sigue heredando.
 */
export function SlideMotion({ t, document: deck, slideId, disabled = false, onSet, onClear }: SlideMotionProps) {
  const [role, setRole] = useState<MotionRole>("in");
  const motion = resolveSlideMotion(deck, slideId);
  const declared = deck.slides.find(({ id }) => id === slideId)?.motion?.[role] !== undefined;
  const current = motion[role];
  const animation = current.animation;

  const label: Record<MotionRole, string> = {
    in: t("motion.in"),
    out: t("motion.out"),
    morph: t("motion.morph"),
  };
  const hint: Record<MotionRole, string> = {
    in: t("motion.inHint"),
    out: t("motion.outHint"),
    morph: t("motion.morphHint"),
  };

  const changeAnimation = (kind: string) => {
    if (role === "morph") {
      onSet(role, { animation: { kind: kind as "morph" | "cut" } });
      return;
    }
    // Cada tipo trae los datos que su forma exige: `slide` necesita una arista
    // y `scale` una escala inicial, o el documento quedaría incompleto.
    const next = kind === "slide"
      ? ({ kind: "slide", edge: "left" } as const)
      : kind === "scale"
        ? ({ kind: "scale", from: 0.8 } as const)
        : ({ kind: kind as "none" | "fade" } as const);
    onSet(role, { animation: next });
  };

  return (
    <section className="motion">
      <header className="motion__head">
        <h3>{t("motion.title")}</h3>
        <span className={`badge ${declared ? "badge--on" : "badge--quiet"}`}>
          {declared ? t("motion.declared") : t("motion.inherited")}
        </span>
      </header>

      <div className="motion__roles" role="tablist" aria-label={t("motion.title")}>
        {ROLES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={role === value}
            tabIndex={role === value ? 0 : -1}
            className={role === value ? "is-active" : ""}
            onClick={() => setRole(value)}
          >
            {label[value]}
          </button>
        ))}
      </div>

      <p className="motion__hint">{hint[role]}</p>

      <SelectField
        label={t("motion.animation")}
        value={animation.kind}
        disabled={disabled}
        options={role === "morph"
          ? [
              { value: "morph", label: t("motion.morphKind") },
              { value: "cut", label: t("motion.cut") },
            ]
          : [
              { value: "none", label: t("motion.none") },
              { value: "fade", label: t("motion.fade") },
              { value: "slide", label: t("motion.slide") },
              { value: "scale", label: t("motion.scale") },
            ]}
        onValueChange={changeAnimation}
      />

      {animation.kind === "slide" && (
        <SelectField
          label={t("motion.edge")}
          value={animation.edge}
          disabled={disabled}
          options={[
            { value: "left", label: t("motion.left") },
            { value: "right", label: t("motion.right") },
            { value: "top", label: t("motion.top") },
            { value: "bottom", label: t("motion.bottom") },
          ]}
          onValueChange={(edge) => onSet(role, { animation: { ...animation, edge: edge as typeof animation.edge } })}
        />
      )}

      {animation.kind === "scale" && (
        <NumberField
          label={t("motion.scaleFrom")}
          value={animation.from}
          min={0}
          step={0.05}
          disabled={disabled}
          onCommit={(from) => onSet(role, { animation: { kind: "scale", from } })}
        />
      )}

      <div className="motion__grid">
        <NumberField
          label={t("motion.duration")}
          value={current.durationBeats}
          min={0}
          step={0.25}
          disabled={disabled}
          onCommit={(durationBeats) => onSet(role, { durationBeats })}
        />
        <NumberField
          label={t("motion.delay")}
          value={current.delayMs}
          min={0}
          step={50}
          disabled={disabled}
          onCommit={(delayMs) => onSet(role, { delayMs })}
        />
      </div>

      <SelectField
        label={t("motion.easing")}
        value={typeof current.easing === "string" ? current.easing : "ease-in-out"}
        disabled={disabled}
        options={[
          { value: "ease-in-out", label: t("motion.easeInOut") },
          { value: "ease-out", label: t("motion.easeOut") },
          { value: "ease-in", label: t("motion.easeIn") },
          { value: "linear", label: t("motion.linear") },
        ]}
        onValueChange={(easing) => onSet(role, { easing: easing as Easing })}
      />

      <p className="motion__hint">
        {t("motion.effective", { ms: effectiveDurationMs(deck.motionBeatMs, current.durationBeats) })}
      </p>

      <button
        type="button"
        className="panel__inline-action"
        disabled={disabled || !declared}
        onClick={() => onClear(role)}
      >
        <RotateCcw aria-hidden="true" /> {t("motion.reset")}
      </button>
    </section>
  );
}
