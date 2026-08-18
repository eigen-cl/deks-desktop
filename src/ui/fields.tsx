import { useEffect, useId, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export interface Option {
  value: string;
  label: string;
}

/**
 * Desplegable real: lista en un portal, teclado completo y estado de selección
 * anunciado. El `<select>` nativo del sistema no se puede pintar y en una
 * ventana oscura aparecía como un control de otro producto.
 */
export function SelectField({
  label,
  value,
  options,
  disabled = false,
  hideLabel = false,
  onValueChange,
}: {
  label: string;
  value: string;
  options: Option[];
  disabled?: boolean;
  hideLabel?: boolean;
  onValueChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id} className={hideLabel ? "sr-only" : "field__label"}>{label}</span>
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger aria-labelledby={id} className="select__trigger">
          <Select.Value />
          <Select.Icon><ChevronDown aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="select__content" position="popper" sideOffset={6}>
            <Select.ScrollUpButton className="select__scroll"><ChevronUp aria-hidden="true" /></Select.ScrollUpButton>
            <Select.Viewport className="select__viewport">
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="select__item">
                  <Select.ItemIndicator className="select__indicator"><Check aria-hidden="true" /></Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select__scroll"><ChevronDown aria-hidden="true" /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/**
 * Número con borrador: escribir «-» o vaciar el campo no puede escribir un
 * `NaN` en el documento, así que el valor sólo sale al confirmar. Las flechas
 * suben y bajan un paso, que es lo que se espera al ajustar geometría.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  short,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  short?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <label className={`field field--number ${short ? "field--short" : ""}`}>
      {short ? <span className="field__prefix" aria-hidden="true">{short}</span> : <span className="field__label">{label}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft}
        onChange={(event) => {
          if (/^[-+]?\d*(?:[.,]\d*)?$/.test(event.target.value)) setDraft(event.target.value.replace(",", "."));
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(String(value));
            event.currentTarget.blur();
          }
          if ((event.key === "ArrowUp" || event.key === "ArrowDown") && draft !== "") {
            event.preventDefault();
            const next = Number(draft) + step * (event.key === "ArrowUp" ? 1 : -1);
            setDraft(String(Number(next.toFixed(4))));
          }
        }}
      />
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        type="text"
        aria-label={label}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <textarea aria-label={label} rows={rows} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

const HEX = /^#[\da-f]{6}$/i;

/**
 * Color con muestra y hexadecimal escribible. El selector del sistema dispara
 * un cambio por cada movimiento del puntero, así que el valor se confirma al
 * soltar: arrastrar el matiz no puede convertirse en cien escrituras a disco.
 */
export function ColorField({
  label,
  value,
  onCommit,
  disabled = false,
}: {
  label: string;
  value: string;
  onCommit(value: string): void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="field field--color">
      <span className="field__label">{label}</span>
      <div className="color-input">
        <input
          type="color"
          aria-label={label}
          disabled={disabled}
          value={HEX.test(draft) ? draft : value}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => { if (HEX.test(draft) && draft !== value) onCommit(draft); }}
        />
        <input
          type="text"
          spellCheck={false}
          aria-label={`${label} · hex`}
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => (HEX.test(draft) ? onCommit(draft) : setDraft(value))}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="toggle__track" aria-hidden="true"><span className="toggle__thumb" /></span>
      <span>{label}</span>
    </button>
  );
}
