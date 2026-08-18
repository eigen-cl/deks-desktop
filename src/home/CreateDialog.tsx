import { useState } from "react";
import { Modal } from "../ui/Modal";
import { ColorField, NumberField, TextField } from "../ui/fields";
import { DEFAULT_PALETTE, PALETTE_KEYS, PRESENTATION_SIZES, type PaletteKey, type PresentationSizeId } from "../model";
import type { Translate } from "../i18n";

export interface CreateDialogProps {
  t: Translate;
  /** Carpeta donde nacerá: se muestra, no se pregunta. */
  folderName: string;
  busy?: boolean;
  onCreate(name: string, canvas: { width: number; height: number }, palette: Record<PaletteKey, string>): void;
  onClose(): void;
}

/**
 * Crear en un diálogo y no en una fila de tarjetas con un campo cada una: el
 * inicio mostraba cuatro formularios compitiendo antes de que hubiera algo que
 * abrir. Aquí la acción es una sola, y el tamaño y la paleta se eligen dentro.
 */
export function CreateDialog({ t, folderName, busy = false, onCreate, onClose }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [size, setSize] = useState<PresentationSizeId>("wide");
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [palette, setPalette] = useState<Record<PaletteKey, string>>({ ...DEFAULT_PALETTE });

  const chooseSize = (value: string) => {
    setSize(value as PresentationSizeId);
    const preset = PRESENTATION_SIZES.find(({ id }) => id === value);
    if (!preset) return;
    setWidth(preset.width);
    setHeight(preset.height);
  };

  const submit = () => {
    if (busy || width < 1 || height < 1) return;
    onCreate(name.trim() === "" ? t("name.untitled") : name.trim(), { width, height }, palette);
  };

  return (
    <Modal
      title={t("create.title")}
      closeLabel={t("action.close")}
      onClose={onClose}
      footer={
        <>
          <span className="modal__note">{t("create.folder", { folder: folderName })}</span>
          <button type="button" className="button" onClick={onClose}>{t("action.cancel")}</button>
          <button type="button" className="button button--primary" disabled={busy} onClick={submit}>
            {busy ? t("create.creating") : t("create.submit")}
          </button>
        </>
      }
    >
      <form
        className="create"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t("create.name")}
          value={name}
          placeholder={t("create.namePlaceholder")}
          disabled={busy}
          onChange={setName}
        />

        <fieldset className="create__sizes">
          <legend>{t("create.size")}</legend>
          <div className="create__size-row">
            {PRESENTATION_SIZES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`size-option ${size === preset.id ? "is-active" : ""}`}
                aria-pressed={size === preset.id}
                disabled={busy}
                onClick={() => chooseSize(preset.id)}
              >
                <span className="size-option__shape" style={{ aspectRatio: `${preset.width} / ${preset.height}` }} />
                <strong>{t(`size.${preset.id}` as const)}</strong>
                <small>{t(`size.${preset.id}Hint` as const)}</small>
              </button>
            ))}
            <button
              type="button"
              className={`size-option ${size === "custom" ? "is-active" : ""}`}
              aria-pressed={size === "custom"}
              disabled={busy}
              onClick={() => setSize("custom")}
            >
              <span className="size-option__shape size-option__shape--custom" />
              <strong>{t("size.custom")}</strong>
              <small>{t("size.customHint")}</small>
            </button>
          </div>
          {size === "custom" && (
            <div className="create__custom">
              <NumberField label={t("create.width")} value={width} min={1} disabled={busy} onCommit={setWidth} />
              <NumberField label={t("create.height")} value={height} min={1} disabled={busy} onCommit={setHeight} />
            </div>
          )}
        </fieldset>

        <details className="create__palette">
          <summary>{t("create.palette")}</summary>
          <p className="panel__hint">{t("create.paletteHint")}</p>
          <div className="create__palette-grid">
            {PALETTE_KEYS.map((key) => (
              <ColorField
                key={key}
                label={t(`palette.${key}` as const)}
                value={palette[key]}
                disabled={busy}
                onCommit={(value) => setPalette((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>
        </details>
      </form>
    </Modal>
  );
}
