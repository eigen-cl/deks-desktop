import { DeksPresentation, assertDeksDocument, type DeksDocument, type SlideBackground } from "@deks-js/document";

export interface OpenProject {
  path: string;
  document: DeksDocument;
}

/** Lo que el host resuelve una vez al arrancar, antes del primer render. */
export interface Workspace {
  defaultRoot: string;
  locale: string | null;
  sourceFolders: string[];
}

/**
 * Resumen para el inicio. Sin `elements`: la tarjeta dibuja el fondo real de la
 * primera slide, que es lo que hace reconocible una presentación de un vistazo,
 * y cargar los elementos de cada carpeta sólo para eso sería caro y no se ve.
 */
export interface ProjectSummary {
  path: string;
  root: string;
  name: string;
  revision: number;
  slideCount: number;
  updatedAtMs: number;
  canvas: { width: number; height: number } | null;
  background: SlideBackground | null;
}

export const PRESENTATION_SIZES = [
  { id: "wide", width: 1920, height: 1080 },
  { id: "standard", width: 1440, height: 1080 },
  { id: "square", width: 1080, height: 1080 },
] as const;

export type PresentationSizeId = (typeof PRESENTATION_SIZES)[number]["id"] | "custom";

/** Paleta con la que nace una presentación. Es la canónica del design system. */
export const DEFAULT_PALETTE = {
  primary: "#FF7043",
  secondary: "#65C18C",
  accent: "#73A7FF",
  background: "#0B0C0E",
  text: "#F2F1EC",
  subtext: "#969DA6",
} as const;

export type PaletteKey = keyof typeof DEFAULT_PALETTE;
export const PALETTE_KEYS = Object.keys(DEFAULT_PALETTE) as PaletteKey[];

/** Traduce un fondo canónico a CSS. Sirve igual para una miniatura y una tarjeta. */
export function backgroundCss(background: SlideBackground | null | undefined): string {
  if (!background) return "var(--color-surface-raised)";
  if (background.kind === "linear-gradient") {
    return `linear-gradient(${background.angleDeg}deg, ${background.startColor}, ${background.endColor})`;
  }
  return background.color;
}

/** Los agentes que el host sabe reconocer. El catálogo de Rust declara los mismos. */
export const AGENT_IDS = [
  "claude-code", "claude-desktop", "codex", "chatgpt-desktop", "cursor", "windsurf",
  "antigravity", "vscode", "zed", "continue", "opencode", "gemini-cli",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

/**
 * Un agente conocido por el host y lo que se sabe de él en este equipo. La
 * detección es sólo lectura: `home` ausente significa que el agente no está
 * instalado, no que no exista.
 */
export interface DetectedAgent {
  id: AgentId;
  group: "claude" | "openai" | "editors" | "cli";
  format: McpConfigFormat;
  home: string | null;
  configPath: string | null;
  skillsPath: string | null;
  skillsInstalled: boolean;
}

export type McpConfigFormat =
  | "mcp-servers-json"
  | "codex-toml"
  | "vscode-json"
  | "zed-json"
  | "opencode-json";

export interface ManagedMcp {
  path: string;
  /** `false` cuando el runtime ya estaba y no se reemplazó. */
  installed: boolean;
}

export interface ProjectChanged {
  path: string;
  revision: number;
  origin: "user" | "agent" | "external";
  changedSlideIds: string[];
  changedElementIds: string[];
}

/**
 * Construye el documento inicial con el builder oficial en vez de un literal
 * escrito a mano. Así la paleta, los presets y la forma canónica los define
 * `@deks-js/document`, y Desktop no puede quedarse con un formato viejo cuando
 * el contrato avanza.
 */
export function createPresentation(
  name: string,
  canvas: { width: number; height: number } = { width: 1920, height: 1080 },
  id: string = crypto.randomUUID(),
  palette: Record<PaletteKey, string> = { ...DEFAULT_PALETTE },
): DeksDocument {
  const presentation = new DeksPresentation({
    id,
    name,
    canvas,
    palette,
    motionBeatMs: 600,
  });
  presentation.addSlide({ name: "Inicio" });
  const document = presentation.toDocument();
  assertDeksDocument(document);
  return document;
}
