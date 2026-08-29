import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDeksCommands, assertDeksDocument, type DeksDocument } from "@deks-js/document";
import { Editor } from "../src/editor/Editor";
import { createElement, createSlide } from "../src/editor/elements";
import { translator } from "../src/i18n";
import { createPresentation } from "../src/model";

// El renderer toca WAAPI y layout real; jsdom no tiene ninguno de los dos. El
// doble deja ver qué documento y qué slide se le pidió dibujar, que es el
// contrato que el editor tiene con él.
const rendered = vi.fn();
vi.mock("@deks-js/renderer-core", () => ({
  RendererCore: class {
    mount(host: HTMLElement) { host.replaceChildren(); }
    setViewportMode() {}
    renderSlide(document: unknown, slideId?: string) { rendered(slideId); }
    compileTransition() { return {}; }
    async play() {}
    destroy() {}
  },
}));

function setup(document: DeksDocument = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio")) {
  const saved: DeksDocument[] = [];
  const persistence = {
    save: async (_revision: number, next: DeksDocument) => {
      // Cada escritura tiene que ser un documento canónico, no una copia
      // conveniente: es lo que abrirá la web.
      assertDeksDocument(next);
      saved.push(next);
      return next;
    },
  };
  const imported = { id: "asset-1", mediaType: "image/png", originalFilename: "logo.png" };
  render(
    <Editor
      t={translator("es")}
      source={document}
      persistence={persistence}
      saveState="idle"
      assets={[]}
      onImportAsset={async () => imported}
      onExit={() => undefined}
    />,
  );
  return { saved, imported };
}

function presentationWithThreeSlides(): DeksDocument {
  const first = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio");
  const second = createSlide(first, "Dos");
  const third = createSlide(first, "Tres");
  return applyDeksCommands(first, [
    { type: "create-slide", slide: second, afterSlideId: first.slides[0]!.id },
    { type: "create-slide", slide: third, afterSlideId: second.id },
  ]).document;
}

function presentationWithElementInheritingSlideMotion(): DeksDocument {
  const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio");
  const slideId = source.slides[0]!.id;
  const { element, state } = createElement(source, slideId, "text", translator("es"));
  return applyDeksCommands(source, [
    { type: "define-element", element },
    { type: "add-element-state", slideId, state },
    {
      type: "set-motion",
      scope: { kind: "slide", slideId },
      role: "in",
      patch: { durationBeats: 2, easing: "linear" },
    },
  ]).document;
}

function presentationWithLogicalGroups(): DeksDocument {
  const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio");
  const slideId = source.slides[0]!.id;
  const title = createElement(source, slideId, "text", translator("es"));
  const card = createElement(source, slideId, "rectangle", translator("es"));
  const free = createElement(source, slideId, "ellipse", translator("es"));
  return applyDeksCommands(source, [
    { type: "define-element", element: { id: "section", kind: "group", name: "Sección", isLocked: false } },
    { type: "define-element", element: { id: "card", kind: "group", name: "Tarjeta", parentId: "section", isLocked: false } },
    { type: "define-element", element: { ...title.element, id: "title", parentId: "card" } },
    { type: "add-element-state", slideId, state: { ...title.state, elementId: "title" } },
    { type: "define-element", element: { ...card.element, id: "card-fill", parentId: "card" } },
    { type: "add-element-state", slideId, state: { ...card.state, elementId: "card-fill" } },
    { type: "define-element", element: { ...free.element, id: "free" } },
    { type: "add-element-state", slideId, state: { ...free.state, elementId: "free" } },
  ]).document;
}

/**
 * Los desplegables son Radix, no `<select>` nativo: se abren y se elige la
 * opción por su etiqueta visible, igual que haría una persona.
 */
async function pickOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => rendered.mockClear());

describe("editor de escritorio", () => {
  it("cambia la preferencia global de idioma desde los ajustes del editor", async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Start");
    render(
      <Editor
        t={translator("en")}
        localePreference="en"
        onLocaleChange={onLocaleChange}
        source={source}
        persistence={{ save: async (_revision, next) => next }}
        saveState="idle"
        assets={[]}
        onImportAsset={async () => undefined}
        onExit={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Editor settings" }));
    await pickOption(user, "Language", "System");
    expect(onLocaleChange).toHaveBeenCalledWith("system");
  });

  it("localiza el contenido inicial que crea la interfaz sin traducir contratos", async () => {
    const user = userEvent.setup();
    const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Start");
    const saved: DeksDocument[] = [];
    render(
      <Editor
        t={translator("en")}
        source={source}
        persistence={{ save: async (_revision, next) => { saved.push(next); return next; } }}
        saveState="idle"
        assets={[]}
        onImportAsset={async () => undefined}
        onExit={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Text" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.elements[0]).toMatchObject({ kind: "text", name: "Text", content: "New text" });
    expect(saved[0]!.slides[0]!.states[0]).not.toHaveProperty("content");
  });

  it("recorre las slides con las flechas izquierda y derecha sin sobrepasar los límites", () => {
    setup(presentationWithThreeSlides());
    const first = screen.getByRole("button", { name: "Diapositiva 1: Inicio" });
    const second = screen.getByRole("button", { name: "Diapositiva 2: Dos" });
    const third = screen.getByRole("button", { name: "Diapositiva 3: Tres" });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(first).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(second).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(third).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(third).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(second).toHaveAttribute("aria-current", "true");
  });

  it("no cambia de slide mientras se edita un input, textarea, select o contenteditable", () => {
    setup(presentationWithThreeSlides());
    const first = screen.getByRole("button", { name: "Diapositiva 1: Inicio" });
    const targets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      document.createElement("div"),
    ];
    targets.at(-1)!.setAttribute("contenteditable", "true");
    targets.forEach((target) => {
      document.body.append(target);
      fireEvent.keyDown(target, { key: "ArrowRight" });
      expect(first).toHaveAttribute("aria-current", "true");
    });
  });

  it("deja las flechas exclusivamente en manos de Presenter mientras está activo", async () => {
    const user = userEvent.setup();
    setup(presentationWithThreeSlides());
    const first = screen.getByRole("button", { name: "Diapositiva 1: Inicio" });

    await user.click(screen.getByRole("button", { name: "Presentar" }));
    const stage = await screen.findByRole("dialog", { name: "Deck" });
    expect(within(stage).getByText("1 / 3")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await within(stage).findByText("2 / 3")).toBeInTheDocument();
    // Si ambos listeners fueran dueños de la flecha, el editor oculto también
    // habría avanzado y al cerrar aparecería en una slide distinta.
    expect(first).toHaveAttribute("aria-current", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deck" })).not.toBeInTheDocument());
    expect(first).toHaveAttribute("aria-current", "true");
  });

  it("inserta un texto como una sola revisión y lo deja seleccionado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Texto" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.revision).toBe(1);
    expect(saved[0]!.elements).toHaveLength(1);
    // Definir identidad y añadir checkpoint viajan juntos: un elemento sin
    // estado no existiría en ninguna slide.
    expect(saved[0]!.slides[0]!.states).toHaveLength(1);
    expect(await screen.findByLabelText("Nombre del elemento")).toHaveValue("Texto");
  });

  it("inserta un rombo canónico y cambia su anchor con presets 3 por 3 sin salto visual", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Rombo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const before = saved.at(-1)!.slides[0]!.states[0]!;
    await user.click(screen.getByRole("button", { name: "Anchor centro" }));

    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.anchor).toEqual({ x: 0.5, y: 0.5 }));
    const after = saved.at(-1)!.slides[0]!.states[0]!;
    expect(saved.at(-1)!.elements[0]).toMatchObject({ kind: "shape", shapeKind: "diamond" });
    expect(after.x).toBe(before.x + before.width / 2);
    expect(after.y).toBe(before.y + before.height / 2);

    await user.click(screen.getByRole("button", { name: "Anchor arriba izquierda" }));
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.x).toBe(before.x));
    const serialized = JSON.parse(JSON.stringify(saved.at(-1)!));
    expect(serialized.slides[0].states[0]).not.toHaveProperty("anchor");
  });

  it("edita el contenido y la geometría del elemento seleccionado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Texto" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    const content = await screen.findByLabelText("Contenido");
    await user.clear(content);
    await user.type(content, "Hola");
    await waitFor(() => {
      const last = saved.at(-1)!;
      expect(last.elements[0]!.content).toBe("Hola");
      expect(last.slides[0]!.states[0]).not.toHaveProperty("content");
    });

    // El número se confirma al aceptar, no en cada tecla: escribir «3» de «300»
    // no puede escribir la posición 3 en el disco.
    const x = screen.getByLabelText("X");
    await user.clear(x);
    await user.type(x, "300{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.x).toBe(300));

    const leftPadding = screen.getByLabelText("Izquierda");
    await user.clear(leftPadding);
    await user.type(leftPadding, "24{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.padding).toEqual({
      top: 0, right: 0, bottom: 0, left: 24,
    }));
    expect(saved.at(-1)!.elements[0]).not.toHaveProperty("padding");
  });

  it("agrega, duplica y borra slides conservando el documento válido", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Diapositiva vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Duplicar diapositiva" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(3));

    await user.click(screen.getByRole("button", { name: "Eliminar diapositiva" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));
  });

  it("reordena las slides desde el teclado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Diapositiva vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    const first = saved.at(-1)!.slides[0]!.id;
    screen.getByRole("button", { name: "Arrastrar la diapositiva 2" }).focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(saved.at(-1)!.slides[1]!.id).toBe(first));
  });

  it("distingue quitar de esta slide de eliminar de la presentación", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    await user.click(await screen.findByRole("button", { name: "Quitar de esta diapositiva" }));
    await waitFor(() => {
      const last = saved.at(-1)!;
      expect(last.slides[0]!.states).toHaveLength(0);
      // La identidad sobrevive: puede seguir viva en otro checkpoint.
      expect(last.elements).toHaveLength(1);
    });
  });

  it("revierte el documento visible cuando el disco rechaza el cambio", async () => {
    const user = userEvent.setup();
    const document = createPresentation("Deck", { width: 1600, height: 900 }, "deck");
    render(
      <Editor
        t={translator("es")}
        source={document}
        persistence={{ save: async () => { throw new Error("revision_conflict"); } }}
        saveState="idle"
        assets={[]}
        onImportAsset={async () => undefined}
        onExit={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Texto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Otro proceso guardó primero/);
    // Nada quedó a medias en pantalla: sin elemento, no hay inspector de elemento.
    await user.click(screen.getByRole("tab", { name: "Elemento" }));
    expect(screen.getByText("Selecciona un elemento para editarlo.")).toBeInTheDocument();
  });

  it("presenta el deck desde la slide activa y vuelve con Escape", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Presentar" }));
    const stage = await screen.findByRole("dialog", { name: "Deck" });
    expect(within(stage).getByText("1 / 1")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deck" })).not.toBeInTheDocument());
  });

  it("no pide el micrófono hasta que la slide tenga un guion no vacío", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    const record = screen.getByRole("button", { name: "Grabar" });
    expect(record).toBeDisabled();
    expect(screen.getByText("Escribe el guion antes de grabar.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Guion"), "Esta slide abre la historia.");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.narration?.script).toBe("Esta slide abre la historia."));
    expect(record).toBeEnabled();
  });
});

describe("assets e historial", () => {
  it("registra el asset y el elemento imagen en una sola revisión", async () => {
    const user = userEvent.setup();
    const { saved, imported } = setup();

    await user.click(screen.getByRole("button", { name: "Imagen" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const document = saved[0]!;
    // Descriptor y elemento viajan juntos: un `assetId` sin descriptor sería un
    // documento que la web rechaza al abrirlo.
    expect(document.assets).toEqual([
      { id: imported.id, kind: "embedded", mediaType: "image/png", originalFilename: "logo.png" },
    ]);
    expect(document.elements[0]).toMatchObject({ kind: "image", name: "logo.png" });
    expect(document.slides[0]!.states[0]).toMatchObject({ assetId: imported.id, fit: "contain" });
  });

  it("bloquea una segunda selección mientras la imagen se está importando", async () => {
    const user = userEvent.setup();
    let finish!: (value: { id: string; mediaType: string }) => void;
    const onImportAsset = vi.fn(() => new Promise<{ id: string; mediaType: string }>((resolve) => { finish = resolve; }));
    const source = createPresentation("Deck", { width: 1600, height: 900 }, "deck");
    render(
      <Editor
        t={translator("es")}
        source={source}
        persistence={{ save: async (_revision, next) => next }}
        saveState="idle"
        assets={[]}
        onImportAsset={onImportAsset}
        onExit={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: "Imagen" });

    await user.dblClick(button);

    expect(onImportAsset).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    finish({ id: "asset-vector", mediaType: "image/svg+xml" });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("deshace un comando a la vez, avanzando la revisión en vez de retrocederla", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Texto" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved.at(-1)!.elements).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(saved).toHaveLength(3));
    // Vuelve el contenido anterior, pero la revisión sigue subiendo: el reloj
    // que comparte con el watcher y los agentes nunca retrocede.
    expect(saved.at(-1)!.elements).toHaveLength(1);
    expect(saved.at(-1)!.revision).toBe(3);

    await user.click(screen.getByRole("button", { name: "Rehacer" }));
    await waitFor(() => expect(saved).toHaveLength(4));
    expect(saved.at(-1)!.elements).toHaveLength(2);
    expect(saved.at(-1)!.revision).toBe(4);
  });

  it("deshabilita deshacer y rehacer cuando no hay a dónde ir", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rehacer" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Texto" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Deshacer" })).toBeEnabled();

    // Editar después de deshacer descarta la rama que rehacer prometía.
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rehacer" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Elipse" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rehacer" })).toBeDisabled());
  });
});

/**
 * jsdom no implementa `PointerEvent`, así que el gesto se arma con el evento de
 * ratón equivalente: lo que importa del arrastre son el tipo, el botón y las
 * coordenadas, y son los tres que el lienzo lee.
 */
function pointer(type: string, target: Window | Element, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }));
}

describe("lienzo", () => {
  it("arrastra un elemento y confirma una sola escritura con la geometría final", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const before = saved.at(-1)!.slides[0]!.states[0]!;

    const target = screen.getByRole("button", { name: "Rectángulo", pressed: true });
    pointer("pointerdown", target, 0, 0);
    pointer("pointermove", window, 40, 25);
    pointer("pointermove", window, 80, 50);
    pointer("pointerup", window, 80, 50);

    // Un gesto, una revisión: mover no puede escribir en disco por frame.
    await waitFor(() => expect(saved).toHaveLength(2));
    const after = saved.at(-1)!.slides[0]!.states[0]!;
    expect(after.x).toBe(before.x + 80);
    expect(after.y).toBe(before.y + 50);
    expect(after.width).toBe(before.width);
  });

  it("cancela el arrastre con Escape sin escribir nada", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    const target = screen.getByRole("button", { name: "Rectángulo", pressed: true });
    pointer("pointerdown", target, 0, 0);
    pointer("pointermove", window, 60, 60);
    fireEvent.keyDown(window, { key: "Escape" });
    pointer("pointerup", window, 60, 60);

    expect(saved).toHaveLength(1);
  });

  it("mueve el elemento seleccionado con las flechas", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const before = saved.at(-1)!.slides[0]!.states[0]!;

    const target = screen.getByRole("button", { name: "Rectángulo", pressed: true });
    target.focus();
    fireEvent.keyDown(target, { key: "ArrowRight", shiftKey: true });

    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.x).toBe(before.x + 10));
  });

  it("abre el menú contextual del elemento y duplica desde ahí", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    fireEvent.contextMenu(screen.getByRole("button", { name: "Rectángulo", pressed: true }));
    await user.click(await screen.findByRole("menuitem", { name: /Duplicar elemento/ }));

    await waitFor(() => expect(saved.at(-1)!.elements).toHaveLength(2));
    // La copia es una identidad propia y nace desplazada, no encima.
    const [first, second] = saved.at(-1)!.slides[0]!.states;
    expect(second!.elementId).not.toBe(first!.elementId);
    expect(second!.x).toBeGreaterThan(first!.x);
  });
});

describe("inventario de elementos", () => {
  it("muestra carpetas lógicas anidadas aunque los grupos no tengan estado", async () => {
    const user = userEvent.setup();
    const source = presentationWithLogicalGroups();
    setup(source);

    await user.click(screen.getByRole("tab", { name: "Elementos" }));

    const section = screen.getByRole("group", { name: "Grupo Sección" });
    const card = within(section).getByRole("group", { name: "Grupo Tarjeta" });
    expect(within(card).getByText("Texto")).toBeInTheDocument();
    expect(within(card).getByText("Rectángulo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar «Elipse»" })).toBeInTheDocument();
    expect(source.slides[0]!.states.some(({ elementId }) => ["section", "card"].includes(elementId))).toBe(false);
  });

  it("no convierte un state histórico de grupo en una caja seleccionable", async () => {
    const source = presentationWithLogicalGroups();
    source.slides[0]!.states.push({
      elementId: "section",
      x: 0,
      y: 0,
      width: 1600,
      height: 900,
      rotationDeg: 0,
      opacity: 1,
      zIndex: -1,
    });
    assertDeksDocument(source);
    setup(source);

    expect(screen.getAllByRole("button").filter((button) =>
      button.classList.contains("canvas__target") && button.getAttribute("aria-label") === "Sección"))
      .toHaveLength(0);
  });

  it("crea un grupo nombrado para la selección como una sola revisión sin moverla", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const before = structuredClone(saved.at(-1)!.slides[0]!.states[0]!);

    await user.click(screen.getByRole("tab", { name: "Elementos" }));
    await user.type(screen.getByLabelText("Nombre del grupo"), "Hero");
    await user.click(screen.getByRole("button", { name: "Crear grupo con la selección" }));

    await waitFor(() => expect(saved).toHaveLength(2));
    const document = saved.at(-1)!;
    const group = document.elements.find(({ kind }) => kind === "group")!;
    const member = document.elements.find(({ kind }) => kind === "shape")!;
    expect(group).toMatchObject({ kind: "group", name: "Hero" });
    expect(member.parentId).toBe(group.id);
    expect(document.slides[0]!.states.some(({ elementId }) => elementId === group.id)).toBe(false);
    expect(document.slides[0]!.states[0]).toEqual(before);
  });

  it("asigna y desagrupa desde el inspector sin conservar parentId ni tocar geometría", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithLogicalGroups());
    await user.click(screen.getAllByRole("button", { name: "Elipse" })
      .find((button) => button.classList.contains("canvas__target"))!);
    const before = structuredClone(presentationWithLogicalGroups().slides[0]!.states.find(({ elementId }) => elementId === "free")!);

    await pickOption(user, "Grupo lógico", "Sección / Tarjeta");
    await waitFor(() => expect(saved.at(-1)!.elements.find(({ id }) => id === "free")!.parentId).toBe("card"));
    expect(saved.at(-1)!.slides[0]!.states.find(({ elementId }) => elementId === "free")).toEqual(before);

    await pickOption(user, "Grupo lógico", "Sin grupo");
    await waitFor(() => expect(saved.at(-1)!.elements.find(({ id }) => id === "free")).not.toHaveProperty("parentId"));
    expect(saved.at(-1)!.slides[0]!.states.find(({ elementId }) => elementId === "free")).toEqual(before);
  });

  it("reaparece en otra slide un elemento que ya existe, sin crear otra identidad", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Diapositiva vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: "Elementos" }));
    await user.click(screen.getByRole("button", { name: "Agregar «Rectángulo» a esta diapositiva" }));

    await waitFor(() => {
      const last = saved.at(-1)!;
      expect(last.elements).toHaveLength(1);
      // La misma identidad en dos checkpoints: es lo que el renderer interpola.
      expect(last.slides[1]!.states[0]!.elementId).toBe(last.slides[0]!.states[0]!.elementId);
    });
  });
});

describe("movimiento de la slide", () => {
  it("muestra el movimiento heredado y declara sólo la propiedad que se toca", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    // Sin declaración propia, los campos muestran lo que resuelve el documento.
    expect(screen.getByText("Heredado del documento")).toBeInTheDocument();
    const duration = screen.getByLabelText("Duración (pulsos)");
    expect(duration).toHaveValue("1");

    await user.clear(duration);
    await user.type(duration, "2{Enter}");

    await waitFor(() => {
      const slide = saved.at(-1)!.slides[0]!;
      expect(slide.motion?.in?.durationBeats).toBe(2);
      // El resto sigue heredando: un parche no congela lo que no se tocó.
      expect(slide.motion?.in?.easing).toBeUndefined();
      expect(slide.motion?.out).toBeUndefined();
    });
    expect(await screen.findByText("Declarado en esta diapositiva")).toBeInTheDocument();
  });

  it("vuelve a heredar al limpiar el rol declarado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    const duration = screen.getByLabelText("Duración (pulsos)");
    await user.clear(duration);
    await user.type(duration, "3{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.motion?.in?.durationBeats).toBe(3));

    await user.click(screen.getByRole("button", { name: "Volver a heredar" }));
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.motion?.in).toBeUndefined());
  });
});

describe("movimiento del elemento seleccionado", () => {
  async function openElementMotion(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole("button", { name: "Texto" })
      .find((button) => button.classList.contains("canvas__target"))!);
    return screen.getByRole("region", { name: "Movimiento del elemento" });
  }

  it("muestra el valor efectivo que hereda de la diapositiva", async () => {
    const user = userEvent.setup();
    const source = presentationWithElementInheritingSlideMotion();
    setup(source);

    const motion = await openElementMotion(user);

    expect(within(motion).getByText("Heredado de la diapositiva")).toBeInTheDocument();
    expect(within(motion).getByLabelText("Duración (pulsos)")).toHaveValue("2");
    expect(within(motion).getByLabelText("Curva")).toHaveTextContent("Lineal");
    expect(source.slides[0]!.states[0]!.motion).toBeUndefined();
  });

  it("recorre los roles con flechas, Home y End manteniendo selección y foco juntos", async () => {
    const user = userEvent.setup();
    setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);
    const roles = within(motion).getByRole("tablist", { name: "Movimiento" });
    const incoming = within(roles).getByRole("tab", { name: "Entrada" });
    const outgoing = within(roles).getByRole("tab", { name: "Salida" });
    const morph = within(roles).getByRole("tab", { name: "Continuo" });

    await user.click(incoming);
    await user.keyboard("{ArrowRight}");
    expect(outgoing).toHaveAttribute("aria-selected", "true");
    expect(outgoing).toHaveFocus();

    await user.keyboard("{End}");
    expect(morph).toHaveAttribute("aria-selected", "true");
    expect(morph).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(outgoing).toHaveAttribute("aria-selected", "true");
    expect(outgoing).toHaveFocus();

    await user.keyboard("{Home}");
    expect(incoming).toHaveAttribute("aria-selected", "true");
    expect(incoming).toHaveFocus();
  });

  it("declara en el elemento sólo el campo que se toca", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);
    const delay = within(motion).getByLabelText("Espera (pulsos)");

    await user.clear(delay);
    await user.type(delay, "1.5{Enter}");

    await waitFor(() => {
      const last = saved.at(-1)!;
      expect(last.slides[0]!.states[0]!.motion).toEqual({ in: { delayBeats: 1.5 } });
      expect(last.slides[0]!.motion?.in).toEqual({ durationBeats: 2, easing: "linear" });
      expect(last.elements[0]).not.toHaveProperty("motion");
    });
    expect(within(motion).getByText("Declarado en este elemento")).toBeInTheDocument();
  });

  it("declara una animación discriminada completa y permite editar sus campos", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);

    await user.click(within(motion).getByLabelText("Animación"));
    await user.click(await screen.findByRole("option", { name: "Cortina" }));
    await waitFor(() => {
      expect(saved.at(-1)!.slides[0]!.states[0]!.motion?.in?.animation)
        .toEqual({ kind: "crop", edge: "bottom" });
    });

    await user.click(within(motion).getByLabelText("Desde"));
    await user.click(await screen.findByRole("option", { name: "Arriba" }));
    await waitFor(() => {
      const animation = saved.at(-1)!.slides[0]!.states[0]!.motion?.in?.animation;
      expect(animation).toEqual({ kind: "crop", edge: "top" });
      expect(animation).not.toHaveProperty("distance");
    });
  });

  it("limita la escala inicial al mínimo canónico", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);

    await user.click(within(motion).getByLabelText("Animación"));
    await user.click(await screen.findByRole("option", { name: "Escalar" }));
    await waitFor(() => {
      expect(saved.at(-1)!.slides[0]!.states[0]!.motion?.in?.animation)
        .toEqual({ kind: "scale", from: 0.8 });
    });

    const scale = within(motion).getByLabelText("Escala inicial");
    await user.clear(scale);
    await user.type(scale, "0{Enter}");

    await waitFor(() => {
      expect(saved.at(-1)!.slides[0]!.states[0]!.motion?.in?.animation)
        .toEqual({ kind: "scale", from: 0.01 });
    });
  });

  it.each([
    ["Duración (pulsos)", 8, (document: DeksDocument) => document.slides[0]!.states[0]!.motion?.in?.durationBeats],
    ["Espera (pulsos)", 16, (document: DeksDocument) => document.slides[0]!.states[0]!.motion?.in?.delayBeats],
    ["Retraso (ms)", 60_000, (document: DeksDocument) => document.slides[0]!.states[0]!.motion?.in?.delayMs],
  ] as const)("limita %s al máximo canónico %i", async (label, maximum, readValue) => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);
    const field = within(motion).getByLabelText(label);

    await user.clear(field);
    await user.type(field, "99999{Enter}");

    await waitFor(() => expect(saved).not.toHaveLength(0));
    expect(readValue(saved.at(-1)!)).toBe(maximum);
  });

  it("limpia la declaración del rol y vuelve a heredar", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());
    const motion = await openElementMotion(user);
    const duration = within(motion).getByLabelText("Duración (pulsos)");

    await user.clear(duration);
    await user.type(duration, "3{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.motion?.in?.durationBeats).toBe(3));

    await user.click(within(motion).getByRole("button", { name: "Volver a heredar" }));

    await waitFor(() => {
      expect(saved.at(-1)!.slides[0]!.states[0]!.motion?.in).toBeUndefined();
      expect(within(motion).getByText("Heredado de la diapositiva")).toBeInTheDocument();
      expect(within(motion).getByLabelText("Duración (pulsos)")).toHaveValue("2");
    });
  });

  it("no muestra ni ejecuta controles de movimiento sin una selección", async () => {
    const user = userEvent.setup();
    const { saved } = setup(presentationWithElementInheritingSlideMotion());

    await user.click(screen.getByRole("tab", { name: "Elemento" }));

    expect(screen.getByText("Selecciona un elemento para editarlo.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Movimiento del elemento" })).not.toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });
});

describe("elemento número", () => {
  it("nace contando al entrar y al cambiar, con su formato completo declarado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Número" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    const document = saved.at(-1)!;
    const identity = document.elements.at(-1)!;
    expect(identity.kind).toBe("number");
    // Contar al entrar y al cambiar es el caso común; salir contando hasta cero
    // es el raro, así que nace apagado.
    expect(identity.animateMagnitude).toEqual({ in: true, morph: true, out: false });

    const state = document.slides[0]!.states.at(-1)!;
    // Sin `content`: los dígitos se derivan del valor y su formato.
    expect(state).not.toHaveProperty("content");
    expect(state.value).toBe(0);
    for (const field of ["decimals", "groupSeparator", "decimalSeparator", "symbol", "symbolPosition"] as const) {
      expect(state[field], field).toBeDefined();
    }
  });

  it("edita la cifra y su símbolo sin tocar la identidad", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Número" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    const value = screen.getByLabelText("Valor");
    await user.clear(value);
    await user.type(value, "38.5{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states.at(-1)!.value).toBe(38.5));

    await user.type(screen.getByLabelText("Símbolo"), "%");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states.at(-1)!.symbol).toBe("%"));
    expect(saved.at(-1)!.elements.at(-1)!.animateMagnitude).toEqual({ in: true, morph: true, out: false });
  });

  it("cambia un toggle de conteo en la identidad, no en la slide", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Número" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    await user.click(screen.getByRole("switch", { name: "Contar al salir" }));

    await waitFor(() => {
      expect(saved.at(-1)!.elements.at(-1)!.animateMagnitude).toEqual({ in: true, morph: true, out: true });
    });
    // La decisión es del elemento: ninguna slide guarda una copia que pueda
    // contradecir a la siguiente.
    expect(saved.at(-1)!.slides[0]!.states.at(-1)).not.toHaveProperty("animateMagnitude");
  });
});

describe("animación crop", () => {
  it("declara la cortina con su borde y sin distancia", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await pickOption(user, "Animación", "Cortina");
    await waitFor(() => {
      expect(saved.at(-1)!.slides[0]!.motion?.in?.animation).toEqual({ kind: "crop", edge: "bottom" });
    });

    await pickOption(user, "Desde", "Arriba");
    await waitFor(() => {
      // El recorrido es el alto del propio elemento: una distancia aquí sería
      // otro efecto, y el documento la rechaza.
      expect(saved.at(-1)!.slides[0]!.motion?.in?.animation).toEqual({ kind: "crop", edge: "top" });
    });
  });

  it("advierte cuando crop de entrada no se ejecutará porque la identidad persiste", async () => {
    const first = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio");
    const slideId = first.slides[0]!.id;
    const { element, state } = createElement(first, slideId, "text", translator("es"));
    const second = { ...createSlide(first, "Continuidad"), states: [{
      ...state,
      motion: { in: { animation: { kind: "crop" as const, edge: "left" as const } } },
    }] };
    const persistent = applyDeksCommands(first, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state },
      { type: "create-slide", slide: second, afterSlideId: slideId },
    ]).document;
    const user = userEvent.setup();
    setup(persistent);

    await user.click(screen.getByRole("button", { name: "Diapositiva 2: Continuidad" }));
    await user.click(screen.getAllByRole("button", { name: "Texto" })
      .find((button) => button.classList.contains("canvas__target"))!);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Este elemento continúa desde la diapositiva anterior: su rol efectivo es Continuo y Entrada · Cortina no se ejecuta.",
    );
  });

  it("advierte cuando crop de salida no se ejecutará porque la identidad persiste", async () => {
    const first = createPresentation("Deck", { width: 1600, height: 900 }, "deck", undefined, "Inicio");
    const slideId = first.slides[0]!.id;
    const { element, state } = createElement(first, slideId, "text", translator("es"));
    const outgoing = {
      ...state,
      motion: { out: { animation: { kind: "crop" as const, edge: "right" as const } } },
    };
    const second = { ...createSlide(first, "Continuidad"), states: [state] };
    const persistent = applyDeksCommands(first, [
      { type: "define-element", element },
      { type: "add-element-state", slideId, state: outgoing },
      { type: "create-slide", slide: second, afterSlideId: slideId },
    ]).document;
    const user = userEvent.setup();
    setup(persistent);

    await user.click(screen.getAllByRole("button", { name: "Texto" })
      .find((button) => button.classList.contains("canvas__target"))!);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Este elemento continúa en la diapositiva siguiente: su rol efectivo es Continuo y Salida · Cortina no se ejecuta.",
    );
  });
});

describe("navegación entre slides", () => {
  it("conserva la pestaña del inspector al cambiar de slide", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Diapositiva vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: "Elementos" }));
    await user.click(screen.getByRole("button", { name: /Diapositiva 1:/ }));

    // Cambiar de slide no puede devolver el panel a otra pestaña: se estaba
    // mirando el inventario para llevar un elemento de una slide a otra.
    expect(screen.getByRole("tab", { name: "Elementos", selected: true })).toBeInTheDocument();
  });
});

describe("nombre de la presentación", () => {
  it("se edita desde el título de la barra y viaja como comando del documento", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de la presentación" }));
    const field = screen.getByLabelText("Nombre de la presentación");
    await user.clear(field);
    await user.type(field, "Pitch de agosto{Enter}");

    await waitFor(() => expect(saved.at(-1)!.name).toBe("Pitch de agosto"));
  });

  it("un nombre vacío deja el anterior en pie", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Cambiar el nombre de la presentación" }));
    const field = screen.getByLabelText("Nombre de la presentación");
    await user.clear(field);
    await user.keyboard("{Enter}");

    expect(saved).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Cambiar el nombre de la presentación" })).toHaveTextContent("Deck");
  });
});
