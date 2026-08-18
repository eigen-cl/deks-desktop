import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DeksDocument } from "@deks-js/document";
import { Home, type HomeProps } from "../src/Home";
import { translator } from "../src/i18n";
import { createPresentation, DEFAULT_PALETTE, type DetectedAgent, type ProjectSummary } from "../src/model";

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

function agent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    id: "claude-code",
    group: "claude",
    format: "mcp-servers-json",
    home: "/Users/ada/.claude",
    configPath: "/Users/ada/.claude.json",
    skillsPath: "/Users/ada/.claude/skills",
    skillsInstalled: false,
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
    agents: {
      detect: async () => [agent()],
      installSkills: vi.fn(async () => undefined),
      installSkillsInFolder: vi.fn(async () => undefined),
      installMcp: async () => ({ path: "/Users/ada/Library/deks-local-mcp", installed: true }),
    },
    loadCover: async () => { throw new Error("no cover"); },
    onCreate: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onAddSourceFolder: vi.fn(),
    onRemoveSourceFolder: vi.fn(),
    onDeleteProject: vi.fn(),
    onRenameProject: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<Home {...props} />) };
}

describe("Home", () => {
  it("muestra cada presentación con su recuento y la abre por su ruta", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    const card = screen.getByRole("button", { name: /Gobernar la IA/ });
    expect(card).toHaveTextContent("15 slides");

    await user.click(card);
    expect(props.onOpenProject).toHaveBeenCalledWith(`${DEFAULT_ROOT}/gobernar-la-ia`);
  });

  it("dibuja la portada real de la presentación, no un rectángulo de color", async () => {
    const cover = createPresentation("Gobernar la IA", { width: 1600, height: 900 }, "deck");
    renderHome({ loadCover: async () => cover });

    // La portada se dibuja con el mismo renderer que el editor: si sólo hubiera
    // un fondo plano, dos presentaciones distintas se verían iguales.
    await waitFor(() => expect(document.querySelector("[data-deks-stage]")).not.toBeNull());
  });

  it("crea desde un diálogo, con el tamaño elegido y sin preguntar dónde", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    await user.click(screen.getByRole("button", { name: "Nueva presentación" }));
    const dialog = screen.getByRole("dialog", { name: "Nueva presentación" });
    await user.type(within(dialog).getByLabelText("Nombre"), "Lanzamiento");
    await user.click(within(dialog).getByRole("button", { name: /Cuadrada/ }));
    await user.click(within(dialog).getByRole("button", { name: "Crear presentación" }));

    expect(props.onCreate).toHaveBeenCalledWith(
      "Lanzamiento",
      { width: 1080, height: 1080 },
      { ...DEFAULT_PALETTE },
    );
  });

  it("acepta un lienzo a medida y usa el nombre por defecto si no se escribe uno", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    await user.click(screen.getByRole("button", { name: "Nueva presentación" }));
    const dialog = screen.getByRole("dialog", { name: "Nueva presentación" });
    await user.click(within(dialog).getByRole("button", { name: /Personalizado/ }));
    const width = within(dialog).getByLabelText("Ancho");
    await user.clear(width);
    await user.type(width, "1200{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Crear presentación" }));

    expect(props.onCreate).toHaveBeenCalledWith(
      "Mi presentación",
      { width: 1200, height: 1080 },
      { ...DEFAULT_PALETTE },
    );
  });

  it("filtra por texto y ofrece limpiar la búsqueda cuando nada coincide", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByLabelText("Buscar presentación"), "gobernar");
    expect(screen.getByRole("button", { name: /Gobernar la IA/ })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Buscar presentación"));
    await user.type(screen.getByLabelText("Buscar presentación"), "nada");
    expect(screen.getByText(/Ninguna presentación coincide con «nada»/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getByRole("button", { name: /Gobernar la IA/ })).toBeInTheDocument();
  });

  it("filtra por carpeta fuente sólo cuando hay más de una", async () => {
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

  it("no muestra el filtro de carpetas cuando sólo existe la carpeta DEKS", () => {
    renderHome();
    expect(screen.queryByRole("navigation", { name: "Carpetas" })).toBeNull();
  });

  it("explica el estado vacío y ofrece crear ahí mismo", () => {
    renderHome({ projects: [] });
    expect(screen.getByText(/Todavía no tienes presentaciones/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nueva presentación" })).toHaveLength(2);
  });
});

describe("configuración", () => {
  it("guarda el idioma desde configuración y reescribe la pantalla completa", async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    const { rerender, props } = renderHome({ onLocaleChange });

    await user.click(screen.getByRole("button", { name: "Configuración" }));
    await user.click(screen.getByRole("combobox", { name: "Idioma" }));
    await user.click(await screen.findByRole("option", { name: "English" }));
    expect(onLocaleChange).toHaveBeenCalledWith("en");

    rerender(<Home {...props} locale="en" t={translator("en")} />);
    expect(screen.getByRole("heading", { name: "Presentations" })).toBeInTheDocument();
  });

  it("agrupa los agentes detectados e instala sus skills en la carpeta global", async () => {
    const user = userEvent.setup();
    const installSkills = vi.fn(async () => undefined);
    renderHome({
      agents: {
        detect: async () => [agent(), agent({ id: "cursor", group: "editors", home: null, skillsPath: null, configPath: "/Users/ada/.cursor/mcp.json" })],
        installSkills,
        installSkillsInFolder: vi.fn(async () => undefined),
        installMcp: async () => ({ path: "/runtime", installed: true }),
      },
    });

    await user.click(screen.getByRole("button", { name: "Configuración" }));
    await user.click(screen.getByRole("button", { name: "Agentes" }));

    expect(await screen.findByRole("heading", { name: "Claude" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Editores" })).toBeInTheDocument();
    // Un agente ausente aparece igual, pero no ofrece instalar nada global.
    expect(screen.getByText("No detectado")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Instalar skills" }));
    expect(installSkills).toHaveBeenCalledWith("claude-code");
  });

  it("entrega el fragmento MCP del formato elegido en vez de escribir la configuración ajena", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("button", { name: "Configuración" }));
    await user.click(screen.getByRole("button", { name: "Agentes" }));
    await user.click(await screen.findByRole("button", { name: "Instalar runtime local" }));

    const snippet = await screen.findByLabelText<HTMLTextAreaElement>(/Configuración para mcpServers/);
    await waitFor(() => expect(snippet.value).toContain("deks-local-mcp/mcp/server.mjs"));
    // El fragmento autoriza una carpeta concreta y no lleva credenciales.
    expect(snippet.value).toContain(DEFAULT_ROOT);
    expect(snippet.value).toContain("mcpServers");
  });
});

describe("eliminar una presentación", () => {
  it("pide confirmación desde el clic derecho antes de mover nada a la papelera", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    fireEvent.contextMenu(screen.getByRole("button", { name: /Gobernar la IA/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Eliminar presentación/ }));

    // El menú no borra: nombra la presentación y explica a dónde va.
    expect(props.onDeleteProject).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: /Eliminar «Gobernar la IA»/ });
    expect(within(dialog).getByText(/papelera del sistema/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Mover a la papelera" }));
    expect(props.onDeleteProject).toHaveBeenCalledWith(`${DEFAULT_ROOT}/gobernar-la-ia`);
  });

  it("cancelar deja la presentación intacta", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    fireEvent.contextMenu(screen.getByRole("button", { name: /Gobernar la IA/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Eliminar presentación/ }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(props.onDeleteProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Gobernar la IA/ })).toBeInTheDocument();
  });
});

describe("cambiar el nombre", () => {
  it("renombra desde el clic derecho sin tocar la ubicación", async () => {
    const user = userEvent.setup();
    const { props } = renderHome();

    fireEvent.contextMenu(screen.getByRole("button", { name: /Gobernar la IA/ }));
    await user.click(await screen.findByRole("menuitem", { name: /Cambiar el nombre/ }));

    const field = screen.getByLabelText("Nombre de la presentación");
    await user.clear(field);
    await user.type(field, "Gobernanza 2026");
    await user.click(screen.getByRole("button", { name: "Guardar el nombre" }));

    expect(props.onRenameProject).toHaveBeenCalledWith(`${DEFAULT_ROOT}/gobernar-la-ia`, "Gobernanza 2026");
  });
});
