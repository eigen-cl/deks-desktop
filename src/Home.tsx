import { useMemo, useState } from "react";
import { Bot, FolderOpen, FolderPlus, PackagePlus, Plus, Search, X } from "lucide-react";
import { PRESENTATION_SIZES, backgroundCss, type PresentationSizeId, type ProjectSummary } from "./model";
import { LOCALES, LOCALE_LABELS, type Locale, type Translate } from "./i18n";

export interface HomeProps {
  t: Translate;
  locale: Locale;
  onLocaleChange(locale: Locale): void;
  projects: ProjectSummary[];
  defaultRoot: string;
  sourceFolders: string[];
  busy: boolean;
  error?: string;
  agentSetupStatus?: string;
  onCreate(name: string, size: PresentationSizeId): void;
  onOpenProject(path: string): void;
  onOpenFolder(): void;
  onAddSourceFolder(): void;
  onRemoveSourceFolder(path: string): void;
  onInstallSkills(): void;
  onInstallMcp(): void;
}

/**
 * Inicio del host: una barra, las formas que se pueden crear y las
 * presentaciones que ya existen. No pide una carpeta antes de mostrar nada —la
 * raíz por defecto ya está resuelta— así que abrir la app no empieza con un
 * diálogo del sistema.
 */
export function Home({
  t,
  locale,
  onLocaleChange,
  projects,
  defaultRoot,
  sourceFolders,
  busy,
  error,
  agentSetupStatus,
  onCreate,
  onOpenProject,
  onOpenFolder,
  onAddSourceFolder,
  onRemoveSourceFolder,
  onInstallSkills,
  onInstallMcp,
}: HomeProps) {
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState<string>();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) =>
      (root === undefined || project.root === root)
      && (needle === "" || project.name.toLowerCase().includes(needle)),
    );
  }, [projects, query, root]);

  const roots = [defaultRoot, ...sourceFolders];

  return (
    <main className="home">
      <header className="home__bar">
        {/* Marca canónica del design system compartido, no una variante propia. */}
        <img className="home__brand" src="/brand/deks-lockup.svg" alt="DEKS" width={104} height={22} />
        <div className="home__bar-actions">
          <label className="home__search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              aria-label={t("home.searchLabel")}
              placeholder={t("home.searchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="home__language">
            <span className="sr-only">{t("home.language")}</span>
            <select value={locale} onChange={(event) => onLocaleChange(event.target.value as Locale)}>
              {LOCALES.map((value) => (
                <option key={value} value={value}>{LOCALE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <button type="button" className="button" disabled={busy} onClick={onOpenFolder}>
            <FolderOpen aria-hidden="true" /> {t("home.openFolder")}
          </button>
        </div>
      </header>

      <nav className="home__roots" aria-label={t("home.sources")}>
        <button
          type="button"
          className={`chip ${root === undefined ? "is-active" : ""}`}
          aria-pressed={root === undefined}
          onClick={() => setRoot(undefined)}
        >
          {t("home.presentations")}
        </button>
        {roots.map((path) => (
          <span key={path} className={`chip chip--folder ${root === path ? "is-active" : ""}`}>
            <button type="button" aria-pressed={root === path} onClick={() => setRoot(path)}>
              {path === defaultRoot ? t("home.defaultRoot") : folderName(path)}
            </button>
            {path !== defaultRoot && (
              <button
                type="button"
                className="chip__remove"
                aria-label={t("home.removeSourceFolder")}
                onClick={() => {
                  if (root === path) setRoot(undefined);
                  onRemoveSourceFolder(path);
                }}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
        <button type="button" className="chip chip--add" disabled={busy} onClick={onAddSourceFolder}>
          <FolderPlus aria-hidden="true" /> {t("home.addSourceFolder")}
        </button>
      </nav>

      <div className="home__scroll">
        <section className="home__section" aria-labelledby="start-creating">
          <h2 id="start-creating">{t("home.startCreating")}</h2>
          <ul className="size-row">
            {PRESENTATION_SIZES.map((size) => (
              <li key={size.id}>
                <NewPresentationCard t={t} size={size} busy={busy} onCreate={onCreate} />
              </li>
            ))}
          </ul>
        </section>

        <section className="home__section" aria-labelledby="recents">
          <h2 id="recents">{t("home.recents")}</h2>
          {visible.length === 0 ? (
            <p className="home__empty">
              {query.trim() === "" ? (
                <>{t("home.empty")} <span>{t("home.emptyHint")}</span></>
              ) : (
                t("home.noMatches", { query: query.trim() })
              )}
            </p>
          ) : (
            <ul className="project-grid">
              {visible.map((project) => (
                <li key={project.path}>
                  <button type="button" className="project-card" onClick={() => onOpenProject(project.path)}>
                    {/* La miniatura conserva la proporción real del lienzo, pero
                        dentro de un marco común: si cada tarjeta creciera con su
                        propio alto, los nombres quedarían a distinta altura y la
                        grilla dejaría de leerse como una fila. */}
                    <span className="project-card__frame" aria-hidden="true">
                      <span
                        className="project-card__thumb"
                        style={{
                          background: backgroundCss(project.background),
                          aspectRatio: project.canvas ? `${project.canvas.width} / ${project.canvas.height}` : "16 / 9",
                        }}
                      />
                    </span>
                    <span className="project-card__name">{project.name}</span>
                    <span className="project-card__meta">
                      {project.slideCount === 1
                        ? t("home.slideCountOne")
                        : t("home.slideCount", { count: project.slideCount })}
                      {" · "}
                      {t("home.revision", { revision: project.revision })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home__section home__agents" aria-labelledby="agents">
          <h2 id="agents">{t("home.agents")}</h2>
          <p>{t("home.agentsHint")}</p>
          <div className="home__agent-actions">
            <button type="button" className="button" disabled={busy} onClick={onInstallSkills}>
              <PackagePlus aria-hidden="true" /> {t("home.installSkills")}
            </button>
            <button type="button" className="button" disabled={busy} onClick={onInstallMcp}>
              <Bot aria-hidden="true" /> {t("home.installMcp")}
            </button>
          </div>
          {agentSetupStatus && <p className="home__status" role="status">{agentSetupStatus}</p>}
          <p className="home__contract">{t("home.localContract")}</p>
        </section>
      </div>

      {error && <p className="home__error" role="alert">{error}</p>}
    </main>
  );
}

/**
 * Cada tamaño crea directamente. El nombre se edita en la propia tarjeta para
 * no anteponer un modal a la acción más común de la pantalla.
 */
function NewPresentationCard({
  t,
  size,
  busy,
  onCreate,
}: {
  t: Translate;
  size: (typeof PRESENTATION_SIZES)[number];
  busy: boolean;
  onCreate(name: string, size: PresentationSizeId): void;
}) {
  const [name, setName] = useState("");
  const label = t(`size.${size.id}` as const);
  const create = () => onCreate(name.trim() === "" ? t("name.untitled") : name.trim(), size.id);

  return (
    <div className="size-card">
      <button
        type="button"
        className="size-card__shape"
        disabled={busy}
        aria-label={`${t("home.newPresentation")} · ${label}`}
        onClick={create}
      >
        <span style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          <Plus aria-hidden="true" />
        </span>
      </button>
      <strong>{label}</strong>
      <small>{t(`size.${size.id}Hint` as const)}</small>
      <input
        value={name}
        disabled={busy}
        aria-label={`${t("name.label")} · ${label}`}
        placeholder={t("name.untitled")}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") create();
        }}
      />
    </div>
  );
}

function folderName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
}
