import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  TRANSLATION_KEYS,
  applyDocumentLocale,
  resolveLocale,
  resolveLocalePreference,
  translator,
} from "../src/i18n";

describe("resolveLocale", () => {
  it("prefiere el idioma guardado sobre el del sistema", () => {
    expect(resolveLocale("en", ["es-CL"])).toBe("en");
    expect(resolveLocale("es", ["en-US"])).toBe("es");
  });

  it("mantiene system como preferencia y resuelve español sólo para un sistema es-*", () => {
    expect(resolveLocalePreference("system")).toBe("system");
    expect(resolveLocale("system", ["es-CL"])).toBe("es");
    expect(resolveLocale("system", ["es-419"])).toBe("es");
    expect(resolveLocale("system", ["en-GB"])).toBe("en");
    expect(resolveLocale("system", ["fr-FR", "es-CL"])).toBe("en");
  });

  it("trata una preferencia ausente o inválida como system y cae a inglés", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(resolveLocalePreference(null)).toBe("system");
    expect(resolveLocalePreference("klingon")).toBe("system");
    expect(resolveLocale("klingon", ["fr-FR", "de"])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined, [])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(7, ["pt-BR"])).toBe(DEFAULT_LOCALE);
  });

  it("sincroniza el idioma resuelto con el nodo raíz del documento", () => {
    const root = document.createElement("html");
    applyDocumentLocale("es", root);
    expect(root).toHaveAttribute("lang", "es");
    applyDocumentLocale("en", root);
    expect(root).toHaveAttribute("lang", "en");
  });
});

describe("translator", () => {
  it("interpola los valores nombrados y deja intacto un marcador sin dato", () => {
    const t = translator("es");
    expect(t("agent.edited", { revision: 81 })).toBe("Agente editó la revisión 81");
    expect(t("home.slideCount", {})).toBe("{count} diapositivas");
  });

  it("traduce la misma clave en cada idioma", () => {
    expect(translator("es")("action.exit")).toBe("Salir");
    expect(translator("en")("action.exit")).toBe("Close");
  });

  it("explica por separado los límites y rechazos seguros de imágenes", () => {
    const es = translator("es");
    const en = translator("en");
    expect(es("error.assetTooLarge")).toMatch(/50 MB.*5 MB.*SVG/);
    expect(en("error.assetTooLarge")).toMatch(/50 MB.*5 MB.*SVG/);
    expect(es("error.assetType")).toMatch(/PNG.*SVG/);
    expect(en("error.assetUnsafe")).toMatch(/sanitized static vectors/);
    expect(es("error.assetComplex")).toMatch(/16\.384.*40 megapíxeles/);
  });

  // El catálogo declara sus dos idiomas por clave, así que la paridad la
  // garantiza el tipo. Esto comprueba lo que el tipo no ve: que ninguna
  // traducción quedó vacía o copiada de la clave.
  it("no deja ninguna clave sin traducir en ningún catálogo", () => {
    for (const locale of LOCALES) {
      const t = translator(locale);
      for (const key of TRANSLATION_KEYS) {
        expect(t(key), `${locale}:${key}`).not.toBe(key);
        expect(t(key).trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });
});
