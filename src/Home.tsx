import { useMemo, useState } from "react";
import { FolderOpen, FolderOpen as OpenIcon, Pencil, Plus, Search, Settings, Trash2, X } from "lucide-react";
import type { DeksDocument } from "@deks-js/document";
import { readProjectCover } from "./desktop-api";
import { CreateDialog } from "./home/CreateDialog";
import { ProjectCard } from "./home/ProjectCard";
import { SettingsDialog } from "./home/SettingsDialog";
import type { AgentSetupProps } from "./home/AgentSetup";
import type { PaletteKey, ProjectSummary } from "./model";
import { IconButton } from "./ui/IconButton";
import { Menu } from "./ui/Menu";
import { Modal } from "./ui/Modal";
import { TextField } from "./ui/fields";
import type { Locale, Translate } from "./i18n";

export interface HomeProps {
  t: Translate;
  locale: Locale;
  onLocaleChange(locale: Locale): void;
  projects: ProjectSummary[];
  defaultRoot: string;
  sourceFolders: string[];
  busy: boolean;
  error?: string;
  agents: Omit<AgentSetupProps, "t" | "projectsRoot" | "busy">;
  /** Inyectable para probar el inicio sin el host de escritorio. */
  loadCover?(path: string): Promise<DeksDocument>;
  onCreate(name: string, canvas: { width: number; height: number }, palette: Record<PaletteKey, string>): void;
  onOpenProject(path: string): void;
  onOpenFolder(): void;
  onAddSourceFolder(): void;
  onRemoveSourceFolder(path: string): void;
  onDeleteProject(path: string): void;
  onRenameProject(path: string, name: string): void;
}

/**
 * Inicio del host: una barra, una acción y las presentaciones que ya existen.
 * Todo lo que no es abrir o crear —idioma, carpetas, agentes— vive en
 * configuración: eran seis bloques compitiendo por la primera pantalla y sólo
 * uno se usa a diario.
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
  agents,
  loadCover = readProjectCover,
  onCreate,
  onOpenProject,
  onOpenFolder,
  onAddSourceFolder,
  onRemoveSourceFolder,
  onDeleteProject,
  onRenameProject,
}: HomeProps) {
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState<{ project: ProjectSummary; point: { x: number; y: number } }>();
  const [confirming, setConfirming] = useState<ProjectSummary>();
  const [renaming, setRenaming] = useState<{ project: ProjectSummary; name: string }>();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) =>
      (root === undefined || project.root === root)
      && (needle === "" || project.name.toLowerCase().includes(needle)),
    );
  }, [projects, query, root]);

  const roots = [defaultRoot, ...sourceFolders].filter(Boolean);

  return (
    <main className="home">
      <header className="home__bar">
        {/* Marca canónica del design system compartido, no una variante propia. */}
        <img className="home__brand" src="/brand/deks-lockup.svg" alt="DEKS" width={104} height={22} />
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
        <IconButton label={t("home.settings")} onClick={() => setSettings(true)}><Settings aria-hidden="true" /></IconButton>
      </header>

      <div className="home__scroll">
        <div className="home__inner">
          <section className="home__heading">
            <div>
              <h1>{t("home.presentations")}</h1>
              <p>{t("home.tagline")}</p>
            </div>
            <div className="home__heading-actions">
              <button type="button" className="button" disabled={busy} onClick={onOpenFolder}>
                <FolderOpen aria-hidden="true" /> {t("home.openFolder")}
              </button>
              <button type="button" className="button button--primary" disabled={busy} onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" /> {t("home.newPresentation")}
              </button>
            </div>
          </section>

          {roots.length > 1 && (
            <nav className="home__roots" aria-label={t("home.sources")}>
              <button
                type="button"
                className={`chip ${root === undefined ? "is-active" : ""}`}
                aria-pressed={root === undefined}
                onClick={() => setRoot(undefined)}
              >
                {t("home.allFolders")}
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
            </nav>
          )}

          {visible.length === 0 ? (
            <section className="home__empty">
              {query.trim() === "" ? (
                <>
                  <strong>{t("home.empty")}</strong>
                  <span>{t("home.emptyHint")}</span>
                  <button type="button" className="button button--primary" disabled={busy} onClick={() => setCreating(true)}>
                    <Plus aria-hidden="true" /> {t("home.newPresentation")}
                  </button>
                </>
              ) : (
                <>
                  <strong>{t("home.noMatches", { query: query.trim() })}</strong>
                  <button type="button" className="button" onClick={() => setQuery("")}>{t("home.emptySearchAction")}</button>
                </>
              )}
            </section>
          ) : (
            <ul className="home__grid">
              {visible.map((project) => (
                <li key={project.path}>
                  <ProjectCard
                    t={t}
                    locale={locale}
                    project={project}
                    loadCover={loadCover}
                    onOpen={onOpenProject}
                    onOpenMenu={(target, point) => setMenu({ project: target, point })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {menu && (
        <Menu
          label={t("home.cardMenu", { name: menu.project.name })}
          point={menu.point}
          items={[
            { id: "open", label: t("home.openPresentation"), icon: <OpenIcon />, run: () => onOpenProject(menu.project.path) },
            {
              id: "rename",
              label: t("home.renamePresentation"),
              icon: <Pencil />,
              run: () => setRenaming({ project: menu.project, name: menu.project.name }),
            },
            {
              id: "delete",
              label: t("home.deletePresentation"),
              icon: <Trash2 />,
              danger: true,
              // Borrar trabajo ajeno no puede pasar por un solo clic torcido:
              // el menú abre la confirmación y ésta nombra la presentación.
              run: () => setConfirming(menu.project),
            },
          ]}
          onClose={() => setMenu(undefined)}
        />
      )}

      {renaming && (
        <Modal
          title={t("rename.title")}
          closeLabel={t("action.close")}
          onClose={() => setRenaming(undefined)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setRenaming(undefined)}>{t("action.cancel")}</button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || renaming.name.trim() === ""}
                onClick={() => {
                  onRenameProject(renaming.project.path, renaming.name.trim());
                  setRenaming(undefined);
                }}
              >
                {t("rename.confirm")}
              </button>
            </>
          }
        >
          <TextField
            label={t("name.label")}
            value={renaming.name}
            autoFocus
            onChange={(name) => setRenaming({ ...renaming, name })}
          />
        </Modal>
      )}

      {confirming && (
        <Modal
          title={t("delete.title", { name: confirming.name })}
          closeLabel={t("action.close")}
          onClose={() => setConfirming(undefined)}
          footer={
            <>
              <button type="button" className="button" onClick={() => setConfirming(undefined)}>{t("action.cancel")}</button>
              <button
                type="button"
                className="button button--danger"
                disabled={busy}
                onClick={() => {
                  onDeleteProject(confirming.path);
                  setConfirming(undefined);
                }}
              >
                <Trash2 aria-hidden="true" /> {t("delete.confirm")}
              </button>
            </>
          }
        >
          <p className="panel__hint">{t("delete.body")}</p>
        </Modal>
      )}

      {creating && (
        <CreateDialog
          t={t}
          folderName={folderName(defaultRoot)}
          busy={busy}
          onCreate={(name, canvas, palette) => {
            setCreating(false);
            onCreate(name, canvas, palette);
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {settings && (
        <SettingsDialog
          t={t}
          locale={locale}
          defaultRoot={defaultRoot}
          sourceFolders={sourceFolders}
          busy={busy}
          agents={agents}
          onLocaleChange={onLocaleChange}
          onAddSourceFolder={onAddSourceFolder}
          onRemoveSourceFolder={onRemoveSourceFolder}
          onClose={() => setSettings(false)}
        />
      )}

      {error && <p className="home__error" role="alert">{error}</p>}
    </main>
  );
}

function folderName(path: string) {
  return path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
}
