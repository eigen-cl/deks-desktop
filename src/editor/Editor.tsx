import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Circle,
  Copy,
  Frame,
  Hash,
  Image,
  Loader,
  Minus,
  Play,
  Redo2,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import type { DeksCommand, DeksDocument, MotionRole, MotionRolePatch } from "@deks-js/document";
import { Canvas } from "./Canvas";
import { EditorSettings } from "./EditorSettings";
import { Inspector, type InspectorTab } from "./Inspector";
import { Presenter } from "./Presenter";
import { SlideMotion } from "./SlideMotion";
import { SlideRail } from "./SlideRail";
import {
  createElement,
  createImageElement,
  createSlide,
  duplicateElement,
  duplicateSlide,
  editorElements,
  slideOf,
  stateForSlide,
  swapZIndex,
  type InsertableKind,
} from "./elements";
import { useEditorPreferences } from "./preferences";
import { useAssetUrls } from "./useAssetUrls";
import { useEditorDocument, type EditorPersistence } from "./useEditorDocument";
import { IconButton } from "../ui/IconButton";
import { Menu, type MenuItem } from "../ui/Menu";
import type { Translate } from "../i18n";

/** Lo único del host que el editor anuncia: si el cambio llegó al disco. */
export type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

export interface EditorProps {
  t: Translate;
  source: DeksDocument;
  persistence: EditorPersistence;
  saveState: SaveState;
  /** Carpeta del proyecto: de ahí salen y ahí entran los assets. */
  projectPath: string;
  onImportAsset(): Promise<{ id: string; mediaType: string; originalFilename?: string } | undefined>;
  onExit(): void;
}

const TOOLS: Array<{ kind: InsertableKind; icon: typeof Type; labelKey: "editor.addText" | "editor.addNumber" | "editor.addRectangle" | "editor.addEllipse" | "editor.addLine" | "editor.addIcon" }> = [
  { kind: "text", icon: Type, labelKey: "editor.addText" },
  { kind: "number", icon: Hash, labelKey: "editor.addNumber" },
  { kind: "rectangle", icon: Square, labelKey: "editor.addRectangle" },
  { kind: "ellipse", icon: Circle, labelKey: "editor.addEllipse" },
  { kind: "line", icon: Minus, labelKey: "editor.addLine" },
  { kind: "icon", icon: Sparkles, labelKey: "editor.addIcon" },
];

type MenuState =
  | { kind: "element"; elementId: string; point: { x: number; y: number } }
  | { kind: "slide"; slideId: string; point: { x: number; y: number } };

export function Editor({ t, source, persistence, saveState, projectPath, onImportAsset, onExit }: EditorProps) {
  const { document: deck, dispatch, pending, conflict, undo, redo, canUndo, canRedo } = useEditorDocument(source, persistence);
  const assetUrls = useAssetUrls(deck, projectPath);
  const [preferences, setPreference] = useEditorPreferences();
  const [activeSlideId, setActiveSlideId] = useState(deck.slides[0]?.id ?? "");
  const [selectedId, setSelectedId] = useState<string>();
  const [tab, setTab] = useState<InspectorTab>("slide");
  const [menu, setMenu] = useState<MenuState>();
  const [settings, setSettings] = useState(false);
  const [presenting, setPresenting] = useState(false);

  // Una slide borrada —aquí o por un agente— no puede dejar la vista apuntando
  // a algo que ya no existe.
  useEffect(() => {
    if (deck.slides.some((slide) => slide.id === activeSlideId)) return;
    setActiveSlideId(deck.slides[0]?.id ?? "");
    setSelectedId(undefined);
  }, [activeSlideId, deck.slides]);

  // Cmd/Ctrl+Z y su variante con Shift. Se ignoran dentro de un campo para no
  // pisar el deshacer nativo de un texto que se está escribiendo.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [redo, undo]);

  const slide = deck.slides.find(({ id }) => id === activeSlideId) ?? deck.slides[0];
  const elements = useMemo(() => (slide ? editorElements(deck, slide.id) : []), [deck, slide]);
  const selected = elements.find(({ id }) => id === selectedId);

  const select = (elementId: string | undefined) => {
    setSelectedId(elementId);
    // Elegir un elemento y tener que buscar su panel serían dos gestos para una
    // sola intención.
    if (elementId) setTab("element");
  };

  useEffect(() => {
    if (!slide) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!selectedId) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setSelectedId(undefined);
        void dispatch({ type: "remove-element-state", slideId: slide.id, elementId: selectedId });
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate(selectedId);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!slide) return <p role="alert">{t("editor.emptyDocument")}</p>;

  const run = (operation: DeksCommand | readonly DeksCommand[]) => { void dispatch(operation); };

  const insert = (kind: InsertableKind) => {
    const { element, state } = createElement(deck, slide.id, kind);
    // Definir la identidad y darle su primer checkpoint es una sola revisión:
    // un elemento sin estado no existiría en ninguna slide.
    void dispatch([
      { type: "define-element", element },
      { type: "add-element-state", slideId: slide.id, state },
    ]).then((ok) => { if (ok) select(element.id); });
  };

  const addSlide = (afterSlideId = slide.id) => {
    const created = createSlide(deck, t("editor.slideDefaultName", { number: deck.slides.length + 1 }));
    void dispatch({ type: "create-slide", slide: created, afterSlideId })
      .then((ok) => { if (ok) { setActiveSlideId(created.id); setSelectedId(undefined); } });
  };

  /**
   * La imagen se copia primero a la carpeta del proyecto y sólo entonces entra
   * al documento: un descriptor que apuntara a bytes ausentes dejaría la
   * presentación rota para cualquiera que la abriera después.
   */
  const insertImage = async () => {
    const asset = await onImportAsset();
    if (!asset) return;
    const { element, state } = createImageElement(deck, slide.id, asset);
    const ok = await dispatch([
      { type: "define-asset", asset: { id: asset.id, kind: "embedded", mediaType: asset.mediaType, ...(asset.originalFilename ? { originalFilename: asset.originalFilename } : {}) } },
      { type: "define-element", element },
      { type: "add-element-state", slideId: slide.id, state },
    ]);
    if (ok) select(element.id);
  };

  const duplicateActiveSlide = (slideId = slide.id) => {
    const copy = duplicateSlide(slideOf(deck, slideId), t("editor.slideCopyName", { name: slideOf(deck, slideId).name }));
    void dispatch({ type: "create-slide", slide: copy, afterSlideId: slideId })
      .then((ok) => { if (ok) { setActiveSlideId(copy.id); setSelectedId(undefined); } });
  };

  const duplicate = (elementId: string) => {
    const source = editorElements(deck, slide.id).find(({ id }) => id === elementId);
    if (!source) return;
    const { element, state } = duplicateElement(deck, slide.id, source);
    void dispatch([
      { type: "define-element", element },
      { type: "add-element-state", slideId: slide.id, state },
    ]).then((ok) => { if (ok) select(element.id); });
  };

  const reorderSlides = (from: number, direction: -1 | 1) => {
    const ids = deck.slides.map((item) => item.id);
    const target = from + direction;
    if (target < 0 || target >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(target, 0, moved!);
    run({ type: "reorder-slides", slideIds: ids });
  };

  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    if (menu.kind === "slide") {
      const index = deck.slides.findIndex((item) => item.id === menu.slideId);
      return [
        { id: "new", label: t("editor.newSlide"), icon: <Frame />, run: () => addSlide(menu.slideId) },
        { id: "duplicate", label: t("editor.duplicateSlide"), icon: <Copy />, run: () => duplicateActiveSlide(menu.slideId) },
        { id: "up", label: t("editor.moveSlideUp", { number: index + 1 }), icon: <ArrowUp />, disabled: index <= 0, run: () => reorderSlides(index, -1) },
        { id: "down", label: t("editor.moveSlideDown", { number: index + 1 }), icon: <ArrowDown />, disabled: index >= deck.slides.length - 1, run: () => reorderSlides(index, 1) },
        {
          id: "delete",
          label: t("editor.deleteSlide"),
          icon: <Trash2 />,
          danger: true,
          disabled: deck.slides.length <= 1,
          run: () => run({ type: "delete-slide", slideId: menu.slideId }),
        },
      ];
    }
    const element = elements.find(({ id }) => id === menu.elementId);
    if (!element) return [];
    return [
      { id: "duplicate", label: t("editor.duplicateElement"), shortcut: "⌘D", icon: <Copy />, run: () => duplicate(element.id) },
      {
        id: "forward",
        label: t("editor.bringForward"),
        icon: <ArrowUp />,
        run: () => run(swapZIndex(deck, slide.id, element.id, 1).map((patch) => ({
          type: "update-element-state" as const,
          slideId: slide.id,
          elementId: patch.elementId,
          patch: { zIndex: patch.zIndex },
        }))),
      },
      {
        id: "backward",
        label: t("editor.sendBackward"),
        icon: <ArrowDown />,
        run: () => run(swapZIndex(deck, slide.id, element.id, -1).map((patch) => ({
          type: "update-element-state" as const,
          slideId: slide.id,
          elementId: patch.elementId,
          patch: { zIndex: patch.zIndex },
        }))),
      },
      {
        id: "lock",
        label: element.isLocked ? t("editor.unlock") : t("editor.lock"),
        run: () => run({ type: "update-element-identity", elementId: element.id, patch: { isLocked: !element.isLocked } }),
      },
      {
        id: "remove",
        label: t("editor.removeFromSlide"),
        shortcut: "⌫",
        run: () => {
          setSelectedId(undefined);
          run({ type: "remove-element-state", slideId: slide.id, elementId: element.id });
        },
      },
      {
        id: "delete",
        label: t("editor.deleteEverywhere"),
        icon: <Trash2 />,
        danger: true,
        run: () => {
          setSelectedId(undefined);
          run({ type: "delete-element", elementId: element.id });
        },
      },
    ];
  };

  return (
    <div className="editor">
      <header className="editor__bar">
        <DeckTitle t={t} name={deck.name} disabled={pending} onRename={(name) => run({ type: "update-document", patch: { name } })} />
        <nav className="editor__tools" aria-label={t("editor.insert")}>
          {TOOLS.map(({ kind, icon: Icon, labelKey }) => (
            <button key={kind} type="button" disabled={pending} onClick={() => insert(kind)}>
              <Icon aria-hidden="true" /> <span>{t(labelKey)}</span>
            </button>
          ))}
          <button type="button" disabled={pending} onClick={() => void insertImage()}>
            <Image aria-hidden="true" /> <span>{t("editor.addImage")}</span>
          </button>
        </nav>
        <div className="editor__history">
          <IconButton label={t("editor.undo")} disabled={pending || !canUndo} onClick={() => void undo()}><Undo2 aria-hidden="true" /></IconButton>
          <IconButton label={t("editor.redo")} disabled={pending || !canRedo} onClick={() => void redo()}><Redo2 aria-hidden="true" /></IconButton>
          <IconButton label={t("editor.settings")} onClick={() => setSettings(true)}><Settings aria-hidden="true" /></IconButton>
        </div>
        <div className="editor__bar-end">
          <button type="button" className="button" onClick={() => setPresenting(true)}>
            <Play aria-hidden="true" /> {t("editor.present")}
          </button>
          <SaveIndicator t={t} state={saveState} />
          <button type="button" className="button" onClick={onExit}>{t("action.exit")}</button>
        </div>
      </header>

      <div className="editor__body">
        <SlideRail
          t={t}
          document={deck}
          activeSlideId={slide.id}
          disabled={pending}
          assetUrls={assetUrls}
          onSelect={(id) => { setActiveSlideId(id); setSelectedId(undefined); }}
          onCreate={() => addSlide()}
          onDuplicate={() => duplicateActiveSlide()}
          onDelete={() => run({ type: "delete-slide", slideId: slide.id })}
          onReorder={(slideIds) => run({ type: "reorder-slides", slideIds })}
          onOpenMenu={(slideId, point) => setMenu({ kind: "slide", slideId, point })}
          footer={
            <SlideMotion
              t={t}
              document={deck}
              slideId={slide.id}
              disabled={pending}
              onSet={(role: MotionRole, patch: MotionRolePatch) =>
                run({ type: "set-motion", scope: { kind: "slide", slideId: slide.id }, role, patch })}
              onClear={(role: MotionRole) =>
                run({ type: "clear-motion", scope: { kind: "slide", slideId: slide.id }, role })}
            />
          }
        />

        <Canvas
          t={t}
          document={deck}
          slideId={slide.id}
          selectedId={selectedId}
          disabled={pending}
          preferences={preferences}
          assetUrls={assetUrls}
          onSelect={select}
          onCommitGeometry={(elementId, patch) =>
            run({ type: "update-element-state", slideId: slide.id, elementId, patch })}
          onOpenMenu={(elementId, point) => setMenu({ kind: "element", elementId, point })}
        />

        <Inspector
          t={t}
          document={deck}
          slide={slide}
          selected={selected}
          disabled={pending}
          tab={tab}
          onTabChange={setTab}
          onSelectElement={select}
          onAddExisting={(elementId, sourceSlideId) => {
            const state = stateForSlide(deck, slide.id, elementId, sourceSlideId);
            void dispatch({ type: "add-element-state", slideId: slide.id, state })
              .then((ok) => { if (ok) select(elementId); });
          }}
          onPatchSlide={(patch) => run({ type: "update-slide", slideId: slide.id, patch })}
          onRenameElement={(name) =>
            selected && run({ type: "update-element-identity", elementId: selected.id, patch: { name } })}
          onLockElement={(isLocked) =>
            selected && run({ type: "update-element-identity", elementId: selected.id, patch: { isLocked } })}
          onAnimateMagnitude={(animateMagnitude) =>
            selected && run({ type: "update-element-identity", elementId: selected.id, patch: { animateMagnitude } })}
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

      {menu && (
        <Menu
          label={menu.kind === "slide"
            ? t("editor.slideMenu", { number: deck.slides.findIndex((item) => item.id === menu.slideId) + 1 })
            : t("editor.elementMenu", { name: elements.find(({ id }) => id === menu.elementId)?.name ?? "" })}
          point={menu.point}
          items={menuItems()}
          onClose={() => setMenu(undefined)}
        />
      )}

      {settings && (
        <EditorSettings
          t={t}
          preferences={preferences}
          motionBeatMs={deck.motionBeatMs}
          disabled={pending}
          onPreferenceChange={setPreference}
          onMotionBeatChange={(motionBeatMs) => run({ type: "update-document", patch: { motionBeatMs } })}
          onClose={() => setSettings(false)}
        />
      )}

      {conflict && <p className="editor__conflict" role="alert">{t("error.conflict")}</p>}
      {presenting && (
        <Presenter
          t={t}
          document={deck}
          initialSlideId={slide.id}
          assetUrls={assetUrls}
          onClose={() => setPresenting(false)}
        />
      )}
    </div>
  );
}

/**
 * El nombre se edita donde se lee. Mandarlo a un diálogo aparte convertía en
 * dos pasos algo que se corrige de una: escribir encima.
 */
function DeckTitle({
  t,
  name,
  disabled,
  onRename,
}: {
  t: Translate;
  name: string;
  disabled: boolean;
  onRename(name: string): void;
}) {
  const [draft, setDraft] = useState<string>();

  if (draft === undefined) {
    return (
      <button
        type="button"
        className="editor__title"
        disabled={disabled}
        aria-label={t("editor.renamePresentation")}
        onClick={() => setDraft(name)}
      >
        {name}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(undefined);
    // Un nombre vacío no es un nombre: se descarta y queda el anterior.
    if (next !== "" && next !== name) onRename(next);
  };

  return (
    <input
      className="editor__title-input"
      autoFocus
      value={draft}
      aria-label={t("editor.presentationName")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(undefined);
      }}
    />
  );
}

/** Aparece al guardar y se va sola; los fallos se quedan hasta que se resuelvan. */
function SaveIndicator({ t, state }: { t: Translate; state: SaveState }) {
  if (state === "idle") return null;
  const failed = state === "failed" || state === "conflict";
  return (
    <div className={`save-state ${failed ? "is-failed" : ""}`} role="status">
      {state === "saving" && <Loader aria-hidden="true" size={13} className="save-state__spin" />}
      {state === "saved" && <Check aria-hidden="true" size={13} />}
      {t(state === "saving" ? "status.saving" : state === "saved" ? "status.saved" : state === "conflict" ? "status.staleRevision" : "status.saveFailed")}
    </div>
  );
}
