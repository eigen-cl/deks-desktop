import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertDeksDocument, type DeksDocument } from "@deks-js/document";
import { Editor } from "../src/editor/Editor";
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

function setup(document: DeksDocument = createPresentation("Deck", { width: 1600, height: 900 }, "deck")) {
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
      projectPath="/tmp/deck"
      onImportAsset={async () => imported}
      onExit={() => undefined}
    />,
  );
  return { saved, imported };
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
      expect(last.slides[0]!.states[0]!.content).toBe("Hola");
    });

    // El número se confirma al aceptar, no en cada tecla: escribir «3» de «300»
    // no puede escribir la posición 3 en el disco.
    const x = screen.getByLabelText("X");
    await user.clear(x);
    await user.type(x, "300{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.states[0]!.x).toBe(300));
  });

  it("agrega, duplica y borra slides conservando el documento válido", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Slide vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Duplicar slide" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(3));

    await user.click(screen.getByRole("button", { name: "Eliminar slide" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));
  });

  it("reordena las slides desde el teclado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Slide vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    const first = saved.at(-1)!.slides[0]!.id;
    screen.getByRole("button", { name: "Arrastrar la slide 2" }).focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(saved.at(-1)!.slides[1]!.id).toBe(first));
  });

  it("distingue quitar de esta slide de eliminar de la presentación", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    await user.click(await screen.findByRole("button", { name: "Quitar de esta slide" }));
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
        projectPath="/tmp/deck"
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
  it("reaparece en otra slide un elemento que ya existe, sin crear otra identidad", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Slide vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: "Elementos" }));
    await user.click(screen.getByRole("button", { name: "Agregar «Rectángulo» a esta slide" }));

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
    const duration = screen.getByLabelText("Duración (beats)");
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
    expect(await screen.findByText("Declarado en esta slide")).toBeInTheDocument();
  });

  it("vuelve a heredar al limpiar el rol declarado", async () => {
    const user = userEvent.setup();
    const { saved } = setup();

    const duration = screen.getByLabelText("Duración (beats)");
    await user.clear(duration);
    await user.type(duration, "3{Enter}");
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.motion?.in?.durationBeats).toBe(3));

    await user.click(screen.getByRole("button", { name: "Volver a heredar" }));
    await waitFor(() => expect(saved.at(-1)!.slides[0]!.motion?.in).toBeUndefined());
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
});

describe("navegación entre slides", () => {
  it("conserva la pestaña del inspector al cambiar de slide", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Slide vacía" }));
    await waitFor(() => expect(saved.at(-1)!.slides).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: "Elementos" }));
    await user.click(screen.getByRole("button", { name: /Slide 1:/ }));

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
