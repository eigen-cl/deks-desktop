import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, TRANSLATION_KEYS, resolveLocale, translator } from "../src/i18n";

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
