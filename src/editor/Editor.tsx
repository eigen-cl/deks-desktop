import { useEffect, useMemo, useState } from "react";
import { Circle, Minus, Play, Radio, Square, Sparkles, Type } from "lucide-react";
import type { DeksCommand, DeksDocument } from "@deks-js/document";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { Presenter } from "./Presenter";
import { SlideRail } from "./SlideRail";
import {
  createElement,
  createSlide,
  duplicateSlide,
  editorElements,
  slideOf,
  type InsertableKind,
} from "./elements";
import { useEditorDocument, type EditorPersistence } from "./useEditorDocument";
import type { Translate } from "../i18n";

export interface EditorProps {
  t: Translate;
  source: DeksDocument;
  persistence: EditorPersistence;
  status: string;
  onExit(): void;
}

const TOOLS: Array<{ kind: InsertableKind; icon: typeof Type; labelKey: "editor.addText" | "editor.addRectangle" | "editor.addEllipse" | "editor.addLine" | "editor.addIcon" }> = [
  { kind: "text", icon: Type, labelKey: "editor.addText" },
  { kind: "rectangle", icon: Square, labelKey: "editor.addRectangle" },
  { kind: "ellipse", icon: Circle, labelKey: "editor.addEllipse" },
  { kind: "line", icon: Minus, labelKey: "editor.addLine" },
  { kind: "icon", icon: Sparkles, labelKey: "editor.addIcon" },
];

export function Editor({ t, source, persistence, status, onExit }: EditorProps) {
  const { document: deck, dispatch, pending, conflict } = useEditorDocument(source, persistence);
  const [activeSlideId, setActiveSlideId] = useState(deck.slides[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string>();
  const [presenting, setPresenting] = useState(false);

  // Una slide borrada —aquí o por un agente— no puede dejar la vista apuntando
  // a algo que ya no existe.
  useEffect(() => {
    if (deck.slides.some((slide) => slide.id === activeSlideId)) return;
    setActiveSlideId(deck.slides[0]?.id ?? "");
    setSelectedId(undefined);
  }, [activeSlideId, deck.slides]);

  const slide = deck.slides.find(({ id }) => id === activeSlideId) ?? deck.slides[0];
  const selected = useMemo(
    () => (slide ? editorElements(deck, slide.id).find(({ id }) => id === selectedId) : undefined),
    [deck, slide, selectedId],
  );

  if (!slide) return <p role="alert">{t("editor.emptyDocument")}</p>;

  const run = (operation: DeksCommand | readonly DeksCommand[]) => { void dispatch(operation); };

  const insert = (kind: InsertableKind) => {
    const { element, state } = createElement(deck, slide.id, kind);
    // Definir la identidad y darle su primer checkpoint es una sola revisión:
    // un elemento sin estado no existiría en ninguna slide.
    void dispatch([
      { type: "define-element", element },
      { type: "add-element-state", slideId: slide.id, state },
    ]).then((ok) => { if (ok) setSelectedId(element.id); });
  };

  const addSlide = () => {
    const created = createSlide(deck, t("editor.slideDefaultName", { number: deck.slides.length + 1 }));
    void dispatch({ type: "create-slide", slide: created, afterSlideId: slide.id })
      .then((ok) => { if (ok) { setActiveSlideId(created.id); setSelectedId(undefined); } });
  };

  const duplicate = () => {
    const copy = duplicateSlide(slideOf(deck, slide.id), t("editor.slideCopyName", { name: slide.name }));
    void dispatch({ type: "create-slide", slide: copy, afterSlideId: slide.id })
      .then((ok) => { if (ok) { setActiveSlideId(copy.id); setSelectedId(undefined); } });
  };

  return (
    <div className="editor">
      <header className="editor__bar">
        <strong className="editor__title">{deck.name}</strong>
        <nav className="editor__tools" aria-label={t("editor.insert")}>
          {TOOLS.map(({ kind, icon: Icon, labelKey }) => (
            <button key={kind} type="button" disabled={pending} onClick={() => insert(kind)}>
              <Icon aria-hidden="true" /> {t(labelKey)}
            </button>
          ))}
        </nav>
        <div className="editor__bar-end">
          <button type="button" className="button" onClick={() => setPresenting(true)}>
            <Play aria-hidden="true" /> {t("editor.present")}
          </button>
          <div className="live-state" role="status">
            <Radio aria-hidden="true" size={14} />
            {status}
          </div>
          <button type="button" className="button" onClick={onExit}>{t("action.exit")}</button>
        </div>
      </header>

      <div className="editor__body">
        <SlideRail
          t={t}
          document={deck}
          activeSlideId={slide.id}
          disabled={pending}
          onSelect={(id) => { setActiveSlideId(id); setSelectedId(undefined); }}
          onCreate={addSlide}
          onDuplicate={duplicate}
          onDelete={() => run({ type: "delete-slide", slideId: slide.id })}
          onReorder={(slideIds) => run({ type: "reorder-slides", slideIds })}
        />

        <Canvas
          t={t}
          document={deck}
          slideId={slide.id}
          selectedId={selectedId}
          disabled={pending}
          onSelect={setSelectedId}
          onCommitGeometry={(elementId, patch) =>
            run({ type: "update-element-state", slideId: slide.id, elementId, patch })}
        />

        <Inspector
          t={t}
          document={deck}
          slide={slide}
          selected={selected}
          disabled={pending}
          onRenameSlide={(name) => run({ type: "update-slide", slideId: slide.id, patch: { name } })}
          onSlideBackground={(color) =>
            run({ type: "update-slide", slideId: slide.id, patch: { background: { kind: "solid", color } } })}
          onRenameElement={(name) =>
            selected && run({ type: "update-element-identity", elementId: selected.id, patch: { name } })}
          onPatchState={(patch) =>
            selected && run({ type: "update-element-state", slideId: slide.id, elementId: selected.id, patch })}
          onRemoveFromSlide={() => {
            if (!selected) return;
            setSelectedId(undefined);
            run({ type: "remove-element-state", slideId: slide.id, elementId: selected.id });
          }}
          onDeleteEverywhere={() => {
            if (!selected) return;
            setSelectedId(undefined);
            run({ type: "delete-element", elementId: selected.id });
          }}
        />
      </div>

      {conflict && <p className="editor__conflict" role="alert">{t("error.conflict")}</p>}
      {presenting && (
        <Presenter t={t} document={deck} initialSlideId={slide.id} onClose={() => setPresenting(false)} />
      )}
    </div>
  );
}
