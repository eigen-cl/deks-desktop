import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyDeksCommands, type DeksDocument } from "@deks-js/document";
import { ArrowUpCircle, Download, X } from "lucide-react";
import {
  addSourceFolder,
  chooseDeksFile,
  chooseDirectory,
  chooseImage,
  createProject,
  deleteProject,
  detectAgents,
  forgetManagedInstall,
  importAsset,
  installAgent,
  listProjects,
  migrateLegacyProject,
  onProjectChanged,
  openProject,
  readWorkspace,
  removeSourceFolder,
  saveProject,
  setLocale as persistLocale,
  syncManagedInstalls,
  watchProject,
} from "./desktop-api";
import { Editor, type SaveState } from "./editor/Editor";
import { Home } from "./Home";
import {
  createPresentation,
  type ManagedInstall,
  type OpenProject,
  type PaletteKey,
  type ProjectSummary,
} from "./model";
import { DEFAULT_LOCALE, resolveLocale, translator, type Locale, type TranslationKey } from "./i18n";
import { checkForUpdate, installUpdate, type UpdateState } from "./updates";
import type { Update } from "@tauri-apps/plugin-updater";

function imageErrorKey(error: unknown, fallback: TranslationKey): TranslationKey {
  const code = String(error);
  if (code.includes("asset_empty")) return "error.assetEmpty";
  if (code.includes("asset_too_large")) return "error.assetTooLarge";
  if (code.includes("asset_media_type_unsupported")) return "error.assetType";
  if (code.includes("asset_unsafe")) return "error.assetUnsafe";
  if (code.includes("asset_too_complex")) return "error.assetComplex";
  return fallback;
}

export function App() {
  const [project, setProject] = useState<OpenProject>();
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [defaultRoot, setDefaultRoot] = useState("");
  const [sourceFolders, setSourceFolders] = useState<string[]>([]);
  const [managedInstalls, setManagedInstalls] = useState<ManagedInstall[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Guardar es lo único del estado interno que la persona necesita ver, y sólo
  // mientras pasa. Anunciar «carpeta abierta · observando cambios» describía la
  // implementación del host, no algo sobre lo que se pueda actuar.
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedTimer = useRef<number>();
  const [errorKey, setErrorKey] = useState<TranslationKey>();
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });
  const pendingUpdate = useRef<Update>();
  const currentRef = useRef<OpenProject>();
  const assetRef = useRef<OpenProject["assets"]>([]);
  const writingRef = useRef(false);
  const ignoredFingerprint = useRef<string>();
  currentRef.current = project;

  // Los textos se guardan como clave, no como frase ya traducida: cambiar de
  // idioma tiene que reescribir también el aviso que está en pantalla.
  const t = useMemo(() => translator(locale), [locale]);
  const error = errorKey && t(errorKey);

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
        setManagedInstalls(workspace.managedInstalls);
        setLocale(resolveLocale(workspace.locale, navigator.languages ?? [navigator.language]));
        await refreshProjects([workspace.defaultRoot, ...workspace.sourceFolders]);
      } catch {
        // Sin workspace el inicio sigue en pie: se puede abrir un `.deks` a mano.
        setLocale(resolveLocale(undefined, navigator.languages ?? [navigator.language]));
      }
    })();
  }, [refreshProjects]);

  useEffect(() => {
    const unlisten = onProjectChanged(async (event) => {
      const current = currentRef.current;
      if (writingRef.current || ignoredFingerprint.current === event.fingerprint) return;
      if (!current || current.path !== event.path || event.fingerprint === current.fingerprint) return;
      try {
        const refreshed = await openProject(current.path);
        assetRef.current = refreshed.assets;
        setProject(refreshed);
        setErrorKey(undefined);
      } catch (caught) {
        setErrorKey(imageErrorKey(caught, "error.externalChange"));
      }
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    // Las instalaciones que la persona pidió mantener se ponen al día al
    // arrancar: una app actualizada trae skills nuevas, y quien ya las instaló
    // no tiene por qué acordarse de volver a hacerlo.
    void syncManagedInstalls().then(setManagedInstalls).catch(() => undefined);
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
      assetRef.current = loaded.assets;
      setProject(loaded);
    } catch (caught) {
      setErrorKey(imageErrorKey(caught, "error.open"));
    } finally {
      setChoosingFolder(false);
    }
  };

  const openExisting = async () => {
    const path = await chooseDeksFile(t("home.openFile"));
    if (path) await open(path);
  };

  const migrateExisting = async () => {
    setChoosingFolder(true);
    setErrorKey(undefined);
    try {
      const path = await chooseDirectory(t("home.migrateFolder"));
      if (!path) return;
      const migrated = await migrateLegacyProject(path);
      await watchProject(migrated.path);
      assetRef.current = migrated.assets;
      setProject(migrated);
      await refreshProjects([defaultRoot, ...sourceFolders]);
    } catch (caught) {
      setErrorKey(imageErrorKey(caught, "error.migrate"));
    } finally {
      setChoosingFolder(false);
    }
  };

  /**
   * Crear no pregunta dónde: la presentación nace en la carpeta DEKS por
   * defecto, que es la que el inicio ya está mostrando.
   */
  const createNew = async (
    name: string,
    canvas: { width: number; height: number },
    palette: Record<PaletteKey, string>,
  ) => {
    setChoosingFolder(true);
    setErrorKey(undefined);
    try {
      const created = await createProject(
        defaultRoot,
        name,
        createPresentation(name, canvas, crypto.randomUUID(), palette),
      );
      await watchProject(created.path);
      assetRef.current = created.assets;
      setProject(created);
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

  /**
   * Eliminar manda el archivo a la papelera del sistema. La lista se refresca
   * después de que el disco confirmó, no antes: una tarjeta que desapareciera
   * mientras el borrado falla mentiría sobre lo que hay en el disco.
   */
  const removeProject = async (path: string) => {
    setErrorKey(undefined);
    try {
      await deleteProject(path);
      await refreshProjects([defaultRoot, ...sourceFolders]);
    } catch {
      setErrorKey("error.delete");
    }
  };

  /**
   * Cambiar el nombre desde el inicio es una edición como cualquier otra: se
   * lee la revisión vigente, se aplica el comando canónico y se confirma con
   * `expectedRevision`. Escribir el nombre a mano en el archivo saltaría el
   * mismo contrato que respeta el editor y que vigilan los agentes.
   */
  const renameProject = async (path: string, name: string) => {
    setErrorKey(undefined);
    try {
      const current = await openProject(path);
      const next = applyDeksCommands(current.document, [{ type: "update-document", patch: { name } }]);
      await saveProject(current, current.document.revision, next.document);
      await refreshProjects([defaultRoot, ...sourceFolders]);
    } catch {
      setErrorKey("error.rename");
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
          agents={{
            managed: managedInstalls,
            detect: detectAgents,
            install: (agentId, folder) => installAgent(agentId, defaultRoot, folder),
            forget: forgetManagedInstall,
            chooseFolder: () => chooseDirectory(t("agents.installFolder")),
          }}
          onCreate={(name, canvas, palette) => void createNew(name, canvas, palette)}
          onOpenProject={(path) => void open(path)}
          onOpenFile={() => void openExisting()}
          onMigrateFolder={() => void migrateExisting()}
          onAddSourceFolder={() => void addSource()}
          onRemoveSourceFolder={(path) => void removeSource(path)}
          onDeleteProject={(path) => void removeProject(path)}
          onRenameProject={(path, name) => void renameProject(path, name)}
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
      _changedSlideIds: string[],
      _changedElementIds: string[],
    ) => {
      window.clearTimeout(savedTimer.current);
      setSaveState("saving");
      setErrorKey(undefined);
      try {
        writingRef.current = true;
        const saved = await saveProject(
          { path: project.path, fingerprint: project.fingerprint, assets: assetRef.current },
          previousRevision,
          next,
        );
        assetRef.current = saved.assets;
        ignoredFingerprint.current = saved.fingerprint;
        setProject(saved);
        // «Guardado» se desvanece solo: es la confirmación de un instante, no
        // un estado permanente que valga un rincón de la barra para siempre.
        setSaveState("saved");
        savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1800);
        return saved.document;
      } catch (caught) {
        const conflict = String(caught).includes("revision_conflict");
        setSaveState(conflict ? "conflict" : "failed");
        setErrorKey(conflict ? "error.conflict" : "error.write");
        throw caught;
      } finally {
        writingRef.current = false;
      }
    },
  };

  return (
    <main className="workspace">
      {updateBanner}
      {error && <aside className="workspace-error" role="alert">{error}</aside>}
      <Editor
        t={t}
        source={project.document}
        persistence={persistence}
        saveState={saveState}
        assets={project.assets}
        onImportAsset={async () => {
          try {
            const source = await chooseImage(t("editor.addImage"));
            if (!source) return undefined;
            const imported = await importAsset(source);
            assetRef.current = [
              ...assetRef.current.filter(({ id }) => id !== imported.id),
              { id: imported.id, mediaType: imported.mediaType, bytes: imported.bytes, contentHash: "" },
            ];
            return imported;
          } catch (caught) {
            setErrorKey(imageErrorKey(caught, "error.asset"));
            return undefined;
          }
        }}
        onExit={() => {
          setProject(undefined);
          assetRef.current = [];
          setSaveState("idle");
          void refreshProjects([defaultRoot, ...sourceFolders]);
        }}
      />
    </main>
  );
}
