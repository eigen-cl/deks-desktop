import { useEffect, useMemo, useRef, useState } from "react";
import { DeksEditor } from "@deks-js/react";
import type { DeksDocument, DeksEditorChange } from "@deks-js/document";
import { Bot, Check, FolderOpen, PackagePlus, Plus, Radio, X } from "lucide-react";
import {
  chooseDirectory,
  createProject,
  installBundledMcp,
  installBundledSkills,
  onProjectChanged,
  openProject,
  saveProject,
  watchProject,
} from "./desktop-api";
import { createPresentation, type OpenProject, type ProjectChanged } from "./model";

function changedIds(change: DeksEditorChange): { slides: string[]; elements: string[] } {
  const operation = change.operation;
  if ("slideId" in operation) {
    return {
      slides: [operation.slideId],
      elements: "elementId" in operation ? [operation.elementId] : "element" in operation ? [operation.element.id] : [],
    };
  }
  if (operation.type === "create-slide") return { slides: [operation.slide.id], elements: [] };
  if (operation.type === "set-transition") return { slides: [operation.fromSlideId, operation.toSlideId], elements: [] };
  return { slides: [], elements: [] };
}

export function App() {
  const [project, setProject] = useState<OpenProject>();
  const [name, setName] = useState("Mi presentación");
  const [status, setStatus] = useState("Local · sin nube");
  const [activity, setActivity] = useState<ProjectChanged>();
  const [error, setError] = useState<string>();
  const [choosingFolder, setChoosingFolder] = useState(false);
  const [agentSetupStatus, setAgentSetupStatus] = useState<string>();
  const currentRef = useRef<OpenProject>();
  currentRef.current = project;

  useEffect(() => {
    const unlisten = onProjectChanged(async (event) => {
      const current = currentRef.current;
      if (!current || current.path !== event.path || event.revision <= current.document.revision) return;
      try {
        const refreshed = await openProject(current.path);
        setProject(refreshed);
        setActivity(event);
        setError(undefined);
        setStatus(event.origin === "agent" ? "El agente actualizó la presentación" : "Cambios externos sincronizados");
      } catch {
        setStatus("No se pudo sincronizar el cambio externo");
        setError("La carpeta cambió, pero el documento nuevo no se pudo abrir. Tu copia visible no fue reemplazada.");
      }
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => undefined); };
  }, []);

  const openExisting = async () => {
    setChoosingFolder(true);
    setError(undefined);
    try {
      const path = await chooseDirectory("Abrir carpeta DEKS");
      if (!path) return;
      const loaded = await openProject(path);
      await watchProject(loaded.path);
      setProject(loaded);
      setStatus("Carpeta abierta · observando cambios");
    } catch {
      setError("No pudimos abrir esa carpeta. Comprueba que contenga un document.deks.json válido.");
    } finally {
      setChoosingFolder(false);
    }
  };

  const createNew = async () => {
    setChoosingFolder(true);
    setError(undefined);
    try {
      const parentPath = await chooseDirectory("Elige dónde crear la carpeta DEKS");
      if (!parentPath || !name.trim()) return;
      const created = await createProject(parentPath, name.trim(), createPresentation(name.trim()));
      await watchProject(created.path);
      setProject(created);
      setStatus("Presentación creada · guardado local activo");
    } catch {
      setError("No pudimos crear la presentación. Elige otra ubicación o un nombre que todavía no exista.");
    } finally {
      setChoosingFolder(false);
    }
  };

  const installSkills = async () => {
    setChoosingFolder(true);
    setAgentSetupStatus(undefined);
    try {
      const destination = await chooseDirectory("Elige la carpeta skills de tu agente");
      if (!destination) return;
      await installBundledSkills(destination);
      setAgentSetupStatus("Skills instaladas. Reinicia tu agente para cargarlas.");
    } catch (caught) {
      setAgentSetupStatus(String(caught).includes("skill_already_exists")
        ? "No reemplazamos las skills existentes. Elige otra carpeta o revísalas antes de actualizar."
        : "No pudimos instalar las skills en esa carpeta.");
    } finally {
      setChoosingFolder(false);
    }
  };

  const installLocalMcp = async () => {
    setChoosingFolder(true);
    setAgentSetupStatus(undefined);
    try {
      const destination = await chooseDirectory("Elige dónde instalar el runtime MCP local");
      if (!destination) return;
      await installBundledMcp(destination);
      setAgentSetupStatus("Runtime instalado en deks-local-mcp. Sigue su README para instalar Node y Chromium.");
    } catch (caught) {
      setAgentSetupStatus(String(caught).includes("mcp_already_exists")
        ? "No reemplazamos el runtime MCP existente. Elige otra carpeta o actualízalo de forma explícita."
        : "No pudimos instalar el runtime MCP en esa carpeta.");
    } finally {
      setChoosingFolder(false);
    }
  };

  const extraControls = useMemo(() => (
    <div className="live-state" role="status">
      <Radio aria-hidden="true" size={16} />
      {status}
    </div>
  ), [status]);

  if (!project) {
    return (
      <main className="welcome">
        <section className="welcome__panel" aria-labelledby="welcome-title">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <p className="eyebrow">DEKS Desktop · Open Core</p>
          <h1 id="welcome-title">Slides locales que tú y tus agentes pueden construir juntos.</h1>
          <p className="lede">Cada presentación vive en una carpeta legible. El editor y el MCP observan el mismo lenguaje DEKS, sin cuenta ni solicitudes de red.</p>
          <label className="project-name">
            Nombre de la presentación
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="welcome__actions">
            <button type="button" className="button button--primary" disabled={choosingFolder} onClick={() => void createNew()}><Plus aria-hidden="true" /> Crear en una carpeta</button>
            <button type="button" className="button" disabled={choosingFolder} onClick={() => void openExisting()}><FolderOpen aria-hidden="true" /> Abrir carpeta DEKS</button>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="local-contract">
            <Check aria-hidden="true" />
            <span><strong>100% local.</strong> Documento, assets, historial y MCP permanecen en tu equipo.</span>
          </div>
          <section className="agent-setup" aria-labelledby="agent-setup-title">
            <div>
              <p className="eyebrow">Agentes</p>
              <h2 id="agent-setup-title">Instala sólo donde tú elijas.</h2>
              <p>Incluye las dos skills oficiales y un runtime MCP local. Nunca reemplazamos archivos existentes.</p>
            </div>
            <div className="welcome__actions">
              <button type="button" className="button" disabled={choosingFolder} onClick={() => void installSkills()}><PackagePlus aria-hidden="true" /> Instalar skills</button>
              <button type="button" className="button" disabled={choosingFolder} onClick={() => void installLocalMcp()}><Bot aria-hidden="true" /> Instalar MCP local</button>
            </div>
            {agentSetupStatus && <p className="agent-setup__status" role="status">{agentSetupStatus}</p>}
          </section>
        </section>
      </main>
    );
  }

  const save = async (change: DeksEditorChange): Promise<{ document: DeksDocument }> => {
    const ids = changedIds(change);
    setStatus("Guardando…");
    setError(undefined);
    try {
      const saved = await saveProject(project.path, change.previousDocument.revision, change.document, ids.slides, ids.elements);
      setProject(saved);
      setStatus("Guardado en carpeta");
      return { document: saved.document };
    } catch (caught) {
      const conflict = String(caught).includes("revision_conflict");
      setStatus(conflict ? "Hay una revisión más nueva" : "No se pudo guardar");
      setError(conflict
        ? "Otro proceso guardó primero. DEKS recargará la revisión confirmada antes de tu próximo cambio."
        : "El cambio no se confirmó en disco. Revisa los permisos de la carpeta e inténtalo otra vez.");
      throw caught;
    }
  };

  return (
    <main className="workspace">
      {activity?.origin === "agent" && (
        <aside className="agent-activity" role="status">
          <Bot aria-hidden="true" />
          <span>Agente editó la revisión {activity.revision}</span>
          <button type="button" aria-label="Ocultar actividad" onClick={() => setActivity(undefined)}><X aria-hidden="true" /></button>
        </aside>
      )}
      {error && <aside className="workspace-error" role="alert">{error}</aside>}
      <DeksEditor
        document={project.document}
        onChange={save}
        extraControls={extraControls}
        onExit={() => { setProject(undefined); setActivity(undefined); setStatus("Local · sin nube"); }}
      />
    </main>
  );
}
