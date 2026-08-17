import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeksDocument } from "@deks-js/document";
import { ArrowUpCircle, Bot, Download, X } from "lucide-react";
import {
  addSourceFolder,
  chooseDirectory,
  chooseImage,
  createProject,
  importAsset,
  installBundledMcp,
  installBundledSkills,
  listProjects,
  onProjectChanged,
  openProject,
  readWorkspace,
  removeSourceFolder,
  saveProject,
  setLocale as persistLocale,
  watchProject,
} from "./desktop-api";
import { Editor } from "./editor/Editor";
import { Home } from "./Home";
import {
  PRESENTATION_SIZES,
  createPresentation,
  type OpenProject,
  type PresentationSizeId,
  type ProjectChanged,
  type ProjectSummary,
} from "./model";
import { DEFAULT_LOCALE, resolveLocale, translator, type Locale, type TranslationKey } from "./i18n";
import { checkForUpdate, installUpdate, type UpdateState } from "./updates";
import type { Update } from "@tauri-apps/plugin-updater";

export function App() {
  const [project, setProject] = useState<OpenProject>();
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [defaultRoot, setDefaultRoot] = useState("");
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [statusKey, setStatusKey] = useState<TranslationKey>("status.local");
  const [activity, setActivity] = useState<ProjectChanged>();
  const [errorKey, setErrorKey] = useState<TranslationKey>();
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [agentSetupStatusKey, setAgentSetupStatusKey] = useState<TranslationKey>();
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const pendingUpdate = useRef<Update>();
  const currentRef = useRef<OpenProject>();
  currentRef.current = project;

  // Los textos se guardan como clave, no como frase ya traducida: cambiar de
  // idioma tiene que reescribir también el aviso que está en pantalla.
  const t = useMemo(() => translator(locale), [locale]);
  const status = t(statusKey);
  const error = errorKey && t(errorKey);
  const agentSetupStatus = agentSetupStatusKey && t(agentSetupStatusKey);

  const refreshProjects = useCallback(async (roots: string[]) => {
    try {
      setProjects(await listProjects(roots.filter(Boolean)));
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const workspace = await readWorkspace();
        setDefaultRoot(workspace.defaultRoot);
        setSourceFolders(workspace.sourceFolders);
        setLocale(resolveLocale(workspace.locale, navigator.languages ?? [navigator.language]));
        await refreshProjects([workspace.defaultRoot, ...workspace.sourceFolders]);
      } catch {
        // Sin workspace el inicio sigue en pie: se puede abrir una carpeta a mano.
        setLocale(resolveLocale(undefined, navigator.languages ?? [navigator.language]));
      }
    })();
  }, [refreshProjects]);

  useEffect(() => {
    const unlisten = onProjectChanged(async (event) => {
      const current = currentRef.current;
      if (!current || current.path !== event.path || event.revision <= current.document.revision) return;
      try {
        const refreshed = await openProject(current.path);
        setProject(refreshed);
        setActivity(event);
        setErrorKey(undefined);
        setStatusKey(event.origin === "agent" ? "status.agentEdited" : "status.synced");
      } catch {
        setStatusKey("status.syncFailed");
        setErrorKey("error.externalChange");
      }
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    // Una comprobación al abrir, sin bloquear nada: si falla, la app local sigue
    // funcionando igual.
    let cancelled = false;
    setUpdate({ status: "checking" });
    void checkForUpdate().then((result) => {
      if (cancelled) return;
      pendingUpdate.current = result.update;
      setUpdate(result.state);
    });
    return () => { cancelled = true; };
  }, []);

  const applyUpdate = async () => {
    const available = pendingUpdate.current;
    if (!available) return;
    await installUpdate(available, setUpdate);
  };

  const open = async (path: string) => {
    setChoosingFolder(true);
    setErrorKey(undefined);
    try {
      const loaded = await openProject(path);
      await watchProject(loaded.path);
      setProject(loaded);
      setStatusKey("status.watching");
    } catch {
      setErrorKey("error.open");
    } finally {
      setChoosingFolder(false);
    }
  };

  const openExisting = async () => {
    const path = await chooseDirectory(t("home.openFolder"));
    if (path) await open(path);
  };

  /**
   * Crear no pregunta dónde: la presentación nace en la carpeta DEKS por
   * defecto, que es la que el inicio ya está mostrando.
   */
  const createNew = async (name: string, size: PresentationSizeId) => {
    const canvas = PRESENTATION_SIZES.find(({ id }) => id === size)!;
    setChoosingFolder(true);
    setErrorKey(undefined);
    try {
      const created = await createProject(
        defaultRoot,
        name,
        createPresentation(name, { width: canvas.width, height: canvas.height }),
      );
      await watchProject(created.path);
      setProject(created);
      setStatusKey("status.created");
      void refreshProjects([defaultRoot, ...sourceFolders]);
    } catch {
      setErrorKey("error.create");
    } finally {
      setChoosingFolder(false);
    }
  };

  const chooseLocale = async (next: Locale) => {
    setLocale(next);
    try {
      await persistLocale(next);
    } catch {
      // El idioma ya cambió en pantalla; no poder guardarlo no lo revierte.
    }
  };

  const addSource = async () => {
    setChoosingFolder(true);
    setErrorKey(undefined);
    try {
      const path = await chooseDirectory(t("home.addSourceFolder"));
      if (!path) return;
      const folders = await addSourceFolder(path);
      setSourceFolders(folders);
      await refreshProjects([defaultRoot, ...folders]);
    } catch (caught) {
      setErrorKey(String(caught).includes("already_added") ? "error.sourceExists" : "error.sourceMissing");
    } finally {
      setChoosingFolder(false);
    }
  };

  const removeSource = async (path: string) => {
    try {
      const folders = await removeSourceFolder(path);
      setSourceFolders(folders);
      await refreshProjects([defaultRoot, ...folders]);
    } catch {
      setErrorKey("error.sourceMissing");
    }
  };

  const installSkills = async () => {
    setChoosingFolder(true);
    setAgentSetupStatusKey(undefined);
    try {
      const destination = await chooseDirectory(t("home.installSkills"));
      if (!destination) return;
      await installBundledSkills(destination);
      setAgentSetupStatusKey("ok.skills");
    } catch (caught) {
      setAgentSetupStatusKey(String(caught).includes("skill_already_exists") ? "error.skillsExist" : "error.skills");
    } finally {
      setChoosingFolder(false);
    }
  };

  const installLocalMcp = async () => {
    setChoosingFolder(true);
    setAgentSetupStatusKey(undefined);
    try {
      const destination = await chooseDirectory(t("home.installMcp"));
      if (!destination) return;
      await installBundledMcp(destination);
      setAgentSetupStatusKey("ok.mcp");
    } catch (caught) {
      setAgentSetupStatusKey(String(caught).includes("mcp_already_exists") ? "error.mcpExists" : "error.mcp");
    } finally {
      setChoosingFolder(false);
    }
  };

  const updateBanner = (update.status === "available" || update.status === "downloading" || update.status === "ready")
    ? (
      <aside className="update-banner" role="status">
        <ArrowUpCircle aria-hidden="true" />
        <div>
          <strong>
            {t(update.status === "ready" ? "update.ready" : "update.available", { version: update.version })}
          </strong>
          <span>
            {update.status === "downloading"
              ? update.percent === undefined
                ? t("update.downloading")
                : t("update.downloadingPercent", { percent: update.percent })
              : update.status === "ready"
                ? t("update.restart")
                : t("update.signed")}
          </span>
        </div>
        {update.status === "available" && (
          <button type="button" className="button button--primary" onClick={() => void applyUpdate()}>
            <Download aria-hidden="true" /> {t("update.apply")}
          </button>
        )}
        <button type="button" className="update-banner__dismiss" aria-label={t("update.dismiss")} onClick={() => setUpdate({ status: "idle" })}>
          <X aria-hidden="true" />
        </button>
      </aside>
    )
    : null;

  if (!project) {
    return (
      <>
        {updateBanner}
        <Home
          t={t}
          locale={locale}
          onLocaleChange={(next) => void chooseLocale(next)}
          projects={projects}
          defaultRoot={defaultRoot}
          sourceFolders={sourceFolders}
          busy={choosingFolder}
          error={error}
          agentSetupStatus={agentSetupStatus}
          onCreate={(name, size) => void createNew(name, size)}
          onOpenProject={(path) => void open(path)}
          onOpenFolder={() => void openExisting()}
          onAddSourceFolder={() => void addSource()}
          onRemoveSourceFolder={(path) => void removeSource(path)}
          onInstallSkills={() => void installSkills()}
          onInstallMcp={() => void installLocalMcp()}
        />
      </>
    );
  }

  /**
   * El editor produce el documento ya aplicado por los comandos de Core y los
   * IDs que tocó; aquí sólo se confirma en disco con la revisión esperada.
   */
  const persistence = {
    save: async (
      previousRevision: number,
      next: DeksDocument,
      changedSlideIds: string[],
      changedElementIds: string[],
    ) => {
      setStatusKey("status.saving");
      setErrorKey(undefined);
      try {
        const saved = await saveProject(project.path, previousRevision, next, changedSlideIds, changedElementIds);
        setProject(saved);
        setStatusKey("status.saved");
        return saved.document;
      } catch (caught) {
        const conflict = String(caught).includes("revision_conflict");
        setStatusKey(conflict ? "status.staleRevision" : "status.saveFailed");
        setErrorKey(conflict ? "error.conflict" : "error.write");
        throw caught;
      }
    },
  };

  return (
    <main className="workspace">
      {updateBanner}
      {activity?.origin === "agent" && (
        <aside className="agent-activity" role="status">
          <Bot aria-hidden="true" />
          <span>{t("agent.edited", { revision: activity.revision })}</span>
          <button type="button" aria-label={t("agent.dismiss")} onClick={() => setActivity(undefined)}><X aria-hidden="true" /></button>
        </aside>
      )}
      {error && <aside className="workspace-error" role="alert">{error}</aside>}
      <Editor
        t={t}
        source={project.document}
        persistence={persistence}
        status={status}
        projectPath={project.path}
        onImportAsset={async () => {
          try {
            const source = await chooseImage(t("editor.addImage"));
            if (!source) return undefined;
            return await importAsset(project.path, source);
          } catch {
            setErrorKey("error.asset");
            return undefined;
          }
        }}
        onExit={() => {
          setProject(undefined);
          setActivity(undefined);
          setStatusKey("status.local");
          void refreshProjects([defaultRoot, ...sourceFolders]);
        }}
      />
    </main>
  );
}
