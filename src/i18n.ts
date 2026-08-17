/**
 * i18n propio y diminuto. Desktop es local-first: una librería de traducción
 * traería carga perezosa, formateadores y un catálogo remoto que aquí no se
 * usan, y el diccionario completo cabe en este archivo. Las claves son planas y
 * el tipo `TranslationKey` las cierra, así que una clave inventada no compila.
 */

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

const es = {
  "app.title": "DEKS Desktop",
  "home.presentations": "Presentaciones",
  "home.startCreating": "Crear",
  "home.recents": "Recientes",
  "home.empty": "Todavía no hay presentaciones en esta carpeta.",
  "home.emptyHint": "Crea una o agrega la carpeta donde ya guardas las tuyas.",
  "home.newPresentation": "Nueva presentación",
  "home.openFolder": "Abrir carpeta",
  "home.addSourceFolder": "Agregar carpeta",
  "home.removeSourceFolder": "Quitar esta carpeta de la vista",
  "home.sources": "Carpetas",
  "home.defaultRoot": "Carpeta DEKS",
  "home.slideCount": "{count} slides",
  "home.slideCountOne": "1 slide",
  "home.revision": "Revisión {revision}",
  "home.searchLabel": "Buscar presentación",
  "home.searchPlaceholder": "Buscar",
  "home.noMatches": "Ninguna presentación coincide con «{query}».",
  "home.language": "Idioma",
  "home.agents": "Agentes",
  "home.installSkills": "Instalar skills",
  "home.installMcp": "Instalar MCP local",
  "home.agentsHint": "Se instalan sólo donde tú elijas. Nunca reemplazamos archivos existentes.",
  "home.localContract": "Documento, assets, historial y MCP permanecen en tu equipo.",
  "size.wide": "Panorámica",
  "size.standard": "Estándar",
  "size.square": "Cuadrada",
  "size.wideHint": "1920 × 1080",
  "size.standardHint": "1440 × 1080",
  "size.squareHint": "1080 × 1080",
  "name.untitled": "Mi presentación",
  "name.label": "Nombre de la presentación",
  "action.create": "Crear",
  "action.cancel": "Cancelar",
  "action.exit": "Salir",
  "status.local": "Local · sin nube",
  "status.saving": "Guardando…",
  "status.saved": "Guardado en carpeta",
  "status.created": "Presentación creada · guardado local activo",
  "status.watching": "Carpeta abierta · observando cambios",
  "status.synced": "Cambios externos sincronizados",
  "status.agentEdited": "El agente actualizó la presentación",
  "status.staleRevision": "Hay una revisión más nueva",
  "status.saveFailed": "No se pudo guardar",
  "status.syncFailed": "No se pudo sincronizar el cambio externo",
  "error.open": "No pudimos abrir esa carpeta. Comprueba que contenga un document.deks.json válido.",
  "error.create": "No pudimos crear la presentación. Elige otra ubicación o un nombre que todavía no exista.",
  "error.externalChange": "La carpeta cambió, pero el documento nuevo no se pudo abrir. Tu copia visible no fue reemplazada.",
  "error.conflict": "Otro proceso guardó primero. DEKS recargará la revisión confirmada antes de tu próximo cambio.",
  "error.write": "El cambio no se confirmó en disco. Revisa los permisos de la carpeta e inténtalo otra vez.",
  "error.sourceExists": "Esa carpeta ya está en la lista.",
  "error.sourceMissing": "No pudimos leer esa carpeta.",
  "error.skillsExist": "No reemplazamos las skills existentes. Elige otra carpeta o revísalas antes de actualizar.",
  "error.skills": "No pudimos instalar las skills en esa carpeta.",
  "error.mcpExists": "No reemplazamos el runtime MCP existente. Elige otra carpeta o actualízalo de forma explícita.",
  "error.mcp": "No pudimos instalar el runtime MCP en esa carpeta.",
  "ok.skills": "Skills instaladas. Reinicia tu agente para cargarlas.",
  "ok.mcp": "Runtime instalado en deks-local-mcp. Sigue su README para instalar Node y Chromium.",
  "agent.edited": "Agente editó la revisión {revision}",
  "agent.dismiss": "Ocultar actividad",
  "update.ready": "DEKS Desktop {version} está listo",
  "update.available": "DEKS Desktop {version} está disponible",
  "update.downloading": "Descargando…",
  "update.downloadingPercent": "Descargando… {percent}%",
  "update.restart": "Se aplicará al reiniciar.",
  "update.signed": "La descarga se verifica con la firma oficial antes de instalarse.",
  "update.apply": "Actualizar",
  "update.dismiss": "Ocultar aviso de actualización",
} as const;

export type TranslationKey = keyof typeof es;

const en: Record<TranslationKey, string> = {
  "app.title": "DEKS Desktop",
  "home.presentations": "Presentations",
  "home.startCreating": "Start creating",
  "home.recents": "Recents",
  "home.empty": "No presentations in this folder yet.",
  "home.emptyHint": "Create one, or add the folder where you already keep yours.",
  "home.newPresentation": "New presentation",
  "home.openFolder": "Open folder",
  "home.addSourceFolder": "Add folder",
  "home.removeSourceFolder": "Remove this folder from the view",
  "home.sources": "Folders",
  "home.defaultRoot": "DEKS folder",
  "home.slideCount": "{count} slides",
  "home.slideCountOne": "1 slide",
  "home.revision": "Revision {revision}",
  "home.searchLabel": "Search presentations",
  "home.searchPlaceholder": "Search",
  "home.noMatches": "No presentation matches “{query}”.",
  "home.language": "Language",
  "home.agents": "Agents",
  "home.installSkills": "Install skills",
  "home.installMcp": "Install local MCP",
  "home.agentsHint": "Installed only where you choose. We never replace existing files.",
  "home.localContract": "Document, assets, history and MCP stay on your machine.",
  "size.wide": "Widescreen",
  "size.standard": "Standard",
  "size.square": "Square",
  "size.wideHint": "1920 × 1080",
  "size.standardHint": "1440 × 1080",
  "size.squareHint": "1080 × 1080",
  "name.untitled": "My presentation",
  "name.label": "Presentation name",
  "action.create": "Create",
  "action.cancel": "Cancel",
  "action.exit": "Close",
  "status.local": "Local · no cloud",
  "status.saving": "Saving…",
  "status.saved": "Saved to folder",
  "status.created": "Presentation created · local saving on",
  "status.watching": "Folder open · watching for changes",
  "status.synced": "External changes synced",
  "status.agentEdited": "An agent updated the presentation",
  "status.staleRevision": "There is a newer revision",
  "status.saveFailed": "Could not save",
  "status.syncFailed": "Could not sync the external change",
  "error.open": "We could not open that folder. Check that it contains a valid document.deks.json.",
  "error.create": "We could not create the presentation. Pick another location or a name that does not exist yet.",
  "error.externalChange": "The folder changed, but the new document could not be opened. Your visible copy was not replaced.",
  "error.conflict": "Another process saved first. DEKS will reload the committed revision before your next change.",
  "error.write": "The change was not committed to disk. Check the folder permissions and try again.",
  "error.sourceExists": "That folder is already in the list.",
  "error.sourceMissing": "We could not read that folder.",
  "error.skillsExist": "We did not replace the existing skills. Pick another folder or review them before updating.",
  "error.skills": "We could not install the skills into that folder.",
  "error.mcpExists": "We did not replace the existing MCP runtime. Pick another folder or update it explicitly.",
  "error.mcp": "We could not install the MCP runtime into that folder.",
  "ok.skills": "Skills installed. Restart your agent to load them.",
  "ok.mcp": "Runtime installed in deks-local-mcp. Follow its README to install Node and Chromium.",
  "agent.edited": "An agent edited revision {revision}",
  "agent.dismiss": "Hide activity",
  "update.ready": "DEKS Desktop {version} is ready",
  "update.available": "DEKS Desktop {version} is available",
  "update.downloading": "Downloading…",
  "update.downloadingPercent": "Downloading… {percent}%",
  "update.restart": "It will be applied on restart.",
  "update.signed": "The download is verified against the official signature before installing.",
  "update.apply": "Update",
  "update.dismiss": "Hide update notice",
};

const CATALOGS: Record<Locale, Record<TranslationKey, string>> = { es, en };

export const LOCALE_LABELS: Record<Locale, string> = { es: "Español", en: "English" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Un idioma guardado gana siempre; sin él se usa el del sistema. `es-CL` y
 * `es-419` son español, así que sólo se compara la subetiqueta primaria.
 */
export function resolveLocale(stored: unknown, systemLanguages: readonly string[] = []): Locale {
  if (isLocale(stored)) return stored;
  for (const language of systemLanguages) {
    const primary = language.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function translator(locale: Locale): Translate {
  const catalog = CATALOGS[locale];
  return (key, values) => {
    const template = catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key] ?? key;
    if (!values) return template;
    return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}
