import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Home, type HomeProps } from "../src/Home";
import { translator } from "../src/i18n";
import type { ProjectSummary } from "../src/model";

const DEFAULT_ROOT = "/Users/ada/Documents/Deks";
const EXTRA_ROOT = "/Volumes/Trabajo/decks";

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    path: `${DEFAULT_ROOT}/gobernar-la-ia`,
    root: DEFAULT_ROOT,
    name: "Gobernar la IA",
    revision: 81,
    slideCount: 15,
    updatedAtMs: 1_760_000_000_000,
    canvas: { width: 1600, height: 900 },
    background: { kind: "solid", color: "#0B1020" },
    ...overrides,
  };
}

function renderHome(overrides: Partial<HomeProps> = {}) {
  const props: HomeProps = {
    t: translator("es"),
    locale: "es",
    onLocaleChange: vi.fn(),
    projects: [project()],
    defaultRoot: DEFAULT_ROOT,
    sourceFolders: [],
    busy: false,
    onCreate: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onAddSourceFolder: vi.fn(),
    onRemoveSourceFolder: vi.fn(),
    onInstallSkills: vi.fn(),
    onInstallMcp: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<Home {...props} />) };
}

describe("Home", () => {
  it("muestra cada presentación con su recuento y revisión, y la abre por su ruta", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    const card = screen.getByRole("button", { name: /Gobernar la IA/ });
    expect(card).toHaveTextContent("15 slides");
    expect(card).toHaveTextContent("Revisión 81");

    await user.click(card);
    expect(props.onOpenProject).toHaveBeenCalledWith(`${DEFAULT_ROOT}/gobernar-la-ia`);
  });

  it("crea en la carpeta por defecto sin preguntar dónde, con el tamaño elegido", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    await user.click(screen.getByRole("button", { name: /Nueva presentación · Cuadrada/ }));
    expect(props.onCreate).toHaveBeenCalledWith("Mi presentación", "square");
  });

  it("usa el nombre escrito en la tarjeta y acepta Enter", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    await user.type(screen.getByLabelText("Nombre de la presentación · Panorámica"), "Lanzamiento{Enter}");
    expect(props.onCreate).toHaveBeenCalledWith("Lanzamiento", "wide");
  });

  it("filtra por texto y avisa cuando nada coincide", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByLabelText("Buscar presentación"), "gobernar");
    expect(screen.getByRole("button", { name: /Gobernar la IA/ })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Buscar presentación"));
    await user.type(screen.getByLabelText("Buscar presentación"), "nada");
    expect(screen.getByText(/Ninguna presentación coincide con «nada»/)).toBeInTheDocument();
  });

  it("filtra por carpeta fuente y sólo permite quitar las agregadas", async () => {
    const user = userEvent.setup();
    const { props } = renderHome({
      sourceFolders: [EXTRA_ROOT],
      projects: [project(), project({ path: `${EXTRA_ROOT}/pulso`, root: EXTRA_ROOT, name: "Pulso" })],
    });

    await user.click(screen.getByRole("button", { name: "decks" }));
    expect(screen.getByRole("button", { name: /Pulso/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gobernar la IA/ })).not.toBeInTheDocument();

    // La carpeta por defecto es del host: se filtra por ella, pero no se quita.
    const defaultChip = screen.getByRole("button", { name: "Carpeta DEKS" }).closest(".chip")!;
    expect(within(defaultChip as HTMLElement).queryByRole("button", { name: /Quitar/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Quitar esta carpeta de la vista" }));
    expect(props.onRemoveSourceFolder).toHaveBeenCalledWith(EXTRA_ROOT);
  });

  it("cambia de idioma y reescribe la pantalla completa", async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    const { rerender, props } = renderHome({ onLocaleChange });

    await user.selectOptions(screen.getByLabelText("Idioma"), "en");
    expect(onLocaleChange).toHaveBeenCalledWith("en");

    rerender(<Home {...props} locale="en" t={translator("en")} />);
    expect(screen.getByRole("heading", { name: "Start creating" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Gobernar la IA/ })).toHaveTextContent("Revision 81");
  });

  it("explica la carpeta vacía en vez de mostrar una grilla en blanco", () => {
    renderHome({ projects: [] });
    expect(screen.getByText(/Todavía no hay presentaciones/)).toBeInTheDocument();
    expect(screen.getByText(/agrega la carpeta donde ya guardas/)).toBeInTheDocument();
  });

  it("dibuja la miniatura con el fondo real y la proporción del lienzo", () => {
    renderHome({
      projects: [project({
        canvas: { width: 1080, height: 1080 },
        background: { kind: "linear-gradient", angleDeg: 130, startColor: "#0A0D2B", endColor: "#1A1040" },
      })],
    });
    // jsdom descarta un gradiente en la abreviatura `background`, así que la
    // comprobación mira el atributo declarado y no el estilo ya parseado.
    const thumb = document.querySelector(".project-card__thumb") as HTMLElement;
    expect(thumb.getAttribute("style")).toContain("linear-gradient(130deg");
    expect(thumb.style.aspectRatio).toBe("1080 / 1080");
  });
});
