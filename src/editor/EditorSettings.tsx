import { Modal } from "../ui/Modal";
import { NumberField, Toggle } from "../ui/fields";
import type { EditorPreferences } from "./preferences";
import type { Translate } from "../i18n";

export interface EditorSettingsProps {
  t: Translate;
  preferences: EditorPreferences;
  motionBeatMs: number;
  disabled?: boolean;
  onPreferenceChange(patch: Partial<EditorPreferences>): void;
  onMotionBeatChange(value: number): void;
  onClose(): void;
}

/**
 * Ajustes del editor. Separa lo que es del host —cuadrícula e imanes, que
 * viven en este equipo— de lo que es del documento: el beat viaja con la
 * presentación porque las transiciones lo heredan en cualquier host.
 */
export function EditorSettings({
  t,
  preferences,
  motionBeatMs,
  disabled = false,
  onPreferenceChange,
  onMotionBeatChange,
  onClose,
}: EditorSettingsProps) {
  return (
    <Modal title={t("editor.settings")} closeLabel={t("action.close")} onClose={onClose}>
      <section className="panel">
        <h3>{t("editor.editing")}</h3>
        <Toggle
          label={t("editor.animateSlideChange")}
          checked={preferences.animateSlideChange}
          onCheckedChange={(animateSlideChange) => onPreferenceChange({ animateSlideChange })}
        />
        <Toggle
          label={t("editor.showGrid")}
          checked={preferences.showGrid}
          onCheckedChange={(showGrid) => onPreferenceChange({ showGrid })}
        />
        <Toggle
          label={t("editor.snapToGrid")}
          checked={preferences.snapToGrid}
          onCheckedChange={(snapToGrid) => onPreferenceChange({ snapToGrid })}
        />
        <Toggle
          label={t("editor.snapToElements")}
          checked={preferences.snapToElements}
          onCheckedChange={(snapToElements) => onPreferenceChange({ snapToElements })}
        />
        <NumberField
          label={t("editor.gridSize")}
          value={preferences.gridStep}
          min={2}
          max={400}
          onCommit={(gridStep) => onPreferenceChange({ gridStep })}
        />
        <p className="panel__hint">{t("editor.animateHint")}</p>
        <p className="panel__hint">{t("editor.snapHint")}</p>
      </section>

      <section className="panel">
        <h3>{t("editor.motionBeat")}</h3>
        <NumberField
          label={t("editor.motionBeat")}
          value={motionBeatMs}
          min={1}
          step={50}
          disabled={disabled}
          onCommit={onMotionBeatChange}
        />
        <p className="panel__hint">{t("editor.motionBeatHint")}</p>
      </section>
    </Modal>
  );
}
