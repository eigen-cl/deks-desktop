import { render, screen, waitFor, within } from "@testing-library/react";
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
    mount() {}
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
  render(
    <Editor t={translator("es")} source={document} persistence={persistence} status="Local" onExit={() => undefined} />,
  );
  return { saved };
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

    const x = screen.getByLabelText("X");
    await user.clear(x);
    await user.type(x, "300");
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
    await user.click(screen.getByRole("button", { name: "Mover la slide 2 arriba" }));
    await waitFor(() => expect(saved.at(-1)!.slides[1]!.id).toBe(first));
  });

  it("distingue quitar de esta slide de eliminar de la presentación", async () => {
    const user = userEvent.setup();
    const { saved } = setup();
    await user.click(screen.getByRole("button", { name: "Rectángulo" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    await user.click(screen.getByRole("button", { name: "Quitar de esta slide" }));
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
        status="Local"
        onExit={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Texto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Otro proceso guardó primero/);
    // Nada quedó a medias en pantalla: sin elemento, no hay inspector de elemento.
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
