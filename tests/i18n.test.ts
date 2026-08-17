import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, resolveLocale, translator } from "../src/i18n";

describe("resolveLocale", () => {
  it("prefiere el idioma guardado sobre el del sistema", () => {
    expect(resolveLocale("en", ["es-CL"])).toBe("en");
  });

  it("reconoce una variante regional por su subetiqueta primaria", () => {
    expect(resolveLocale(undefined, ["es-CL", "en-US"])).toBe("es");
    expect(resolveLocale(null, ["en-GB"])).toBe("en");
  });

  it("cae al idioma por defecto ante un valor inservible o un idioma que no existe", () => {
    expect(resolveLocale("klingon", ["fr-FR", "de"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, [])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(7, ["pt-BR"])).toBe(DEFAULT_LOCALE);
  });
});

describe("translator", () => {
  it("interpola los valores nombrados y deja intacto un marcador sin dato", () => {
    const t = translator("es");
    expect(t("agent.edited", { revision: 81 })).toBe("Agente editó la revisión 81");
    expect(t("home.slideCount", {})).toBe("{count} slides");
  });

  it("traduce la misma clave en cada idioma", () => {
    expect(translator("es")("action.exit")).toBe("Salir");
    expect(translator("en")("action.exit")).toBe("Close");
  });

  it("no deja ninguna clave sin traducir en ningún catálogo", () => {
    const spanish = translator("es");
    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const key of Object.keys({ ...catalogKeys(spanish) })) {
        const value = t(key as Parameters<typeof t>[0]);
        expect(value, `${locale}:${key}`).not.toBe(key);
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });
});

/**
 * El catálogo no se exporta como objeto, así que las claves se recogen del
 * único lugar que las declara todas: el propio tipo, materializado aquí como la
 * lista que usa la app.
 */
function catalogKeys(t: ReturnType<typeof translator>) {
  const keys = [
    "app.title", "home.presentations", "home.startCreating", "home.recents", "home.empty",
    "home.emptyHint", "home.newPresentation", "home.openFolder", "home.addSourceFolder",
    "home.removeSourceFolder", "home.sources", "home.defaultRoot", "home.slideCount",
    "home.slideCountOne", "home.revision", "home.searchLabel", "home.searchPlaceholder",
    "home.noMatches", "home.language", "home.agents", "home.installSkills", "home.installMcp",
    "home.agentsHint", "home.localContract", "size.wide", "size.standard", "size.square",
    "size.wideHint", "size.standardHint", "size.squareHint", "name.untitled", "name.label",
    "action.create", "action.cancel", "action.exit", "status.local", "status.saving",
    "status.saved", "status.created", "status.watching", "status.synced", "status.agentEdited",
    "status.staleRevision", "status.saveFailed", "status.syncFailed", "error.open", "error.create",
    "error.externalChange", "error.conflict", "error.write", "error.sourceExists",
    "error.sourceMissing", "error.skillsExist", "error.skills", "error.mcpExists", "error.mcp",
    "ok.skills", "ok.mcp", "agent.edited", "agent.dismiss", "update.ready", "update.available",
    "update.downloading", "update.downloadingPercent", "update.restart", "update.signed",
    "update.apply", "update.dismiss",
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(key)]));
}
