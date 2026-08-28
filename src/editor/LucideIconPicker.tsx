import { createElement, useId, useMemo, useState } from "react";
import {
  getLucideIconData,
  lucideIconNames,
  type LucideSvgAttribute,
} from "@deks-js/document";
import type { Translate } from "../i18n";

const VISIBLE_LIMIT = 60;
const REACT_ATTRIBUTE: Partial<Record<LucideSvgAttribute, string>> = {
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
};

const labelOf = (name: string) => name.split("-")
  .map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part)
  .join(" ");

const searchKey = (value: string) => value.trim().toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

function LucideGlyph({ name }: { name: string }) {
  const icon = getLucideIconData(name);
  return (
    <svg viewBox={`0 0 ${icon.width} ${icon.height}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icon.nodes.map(([tag, attributes], index) => createElement(tag, {
        key: `${name}-${index}`,
        ...Object.fromEntries(Object.entries(attributes).map(([key, value]) => [
          REACT_ATTRIBUTE[key as LucideSvgAttribute] ?? key,
          value,
        ])),
      }))}
    </svg>
  );
}

export function LucideIconPicker({
  t,
  value,
  disabled = false,
  onValueChange,
}: {
  t: Translate;
  value: string;
  disabled?: boolean;
  onValueChange(value: string): void;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [page, setPage] = useState(0);
  const matches = useMemo(() => {
    const key = searchKey(query);
    return key ? lucideIconNames.filter((name) => searchKey(name).includes(key)) : lucideIconNames;
  }, [query]);
  const pageCount = Math.max(1, Math.ceil(matches.length / VISIBLE_LIMIT));
  const visible = matches.slice(page * VISIBLE_LIMIT, (page + 1) * VISIBLE_LIMIT);
  const activeName = activeIndex >= 0 ? visible[activeIndex] : undefined;
  const select = (name: string) => {
    onValueChange(name);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
    setPage(0);
  };

  return (
    <div className="lucide-picker">
      <div className="lucide-picker__current" aria-label={t("editor.iconSelected", { name: labelOf(value) })}>
        <LucideGlyph name={value} />
        <span>{labelOf(value)}</span>
      </div>
      <label className="field">
        <span className="field__label">{t("editor.iconSearch")}</span>
        <input
          role="combobox"
          aria-label={t("editor.iconSearch")}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeName ? `${listboxId}-${activeName}` : undefined}
          autoComplete="off"
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
            setPage(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              setActiveIndex(-1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(visible.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(Math.max(0, visible.length - 1));
            } else if (event.key === "Enter" && activeName) {
              event.preventDefault();
              select(activeName);
            }
          }}
        />
      </label>
      {open && (visible.length > 0 ? (
        <div className="lucide-picker__popover">
          <div id={listboxId} className="lucide-picker__grid" role="listbox" aria-label={t("editor.iconResults")}>
            {visible.map((name, index) => (
              <div
                id={`${listboxId}-${name}`}
                key={name}
                role="option"
                aria-selected={name === value}
                className={index === activeIndex ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(name)}
              >
                <LucideGlyph name={name} />
                <span>{labelOf(name)}</span>
              </div>
            ))}
          </div>
          <p className="sr-only" aria-live="polite">{t("editor.iconCount", { count: matches.length })}</p>
          {pageCount > 1 && (
            <div className="lucide-picker__pagination">
              <button
                type="button"
                disabled={page === 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setPage((current) => Math.max(0, current - 1)); setActiveIndex(-1); }}
              >{t("editor.iconPreviousPage")}</button>
              <span aria-live="polite">{t("editor.iconPage", { page: page + 1, pages: pageCount })}</span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { setPage((current) => Math.min(pageCount - 1, current + 1)); setActiveIndex(-1); }}
              >{t("editor.iconNextPage")}</button>
            </div>
          )}
        </div>
      ) : <p role="status" className="panel__hint">{t("editor.iconNoResults")}</p>)}
    </div>
  );
}
