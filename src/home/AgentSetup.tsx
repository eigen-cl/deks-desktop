import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, FolderPlus, PackagePlus, X } from "lucide-react";
import { mcpConfigSnippet } from "../agents";
import type { DetectedAgent, ManagedInstall, McpConfigFormat } from "../model";
import { SelectField } from "../ui/fields";
import type { Translate, TranslationKey } from "../i18n";

export interface AgentSetupProps {
  t: Translate;
  /** Carpeta de presentaciones que autoriza una instalación global. */
  projectsRoot: string;
  busy?: boolean;
  managed: ManagedInstall[];
  detect(): Promise<DetectedAgent[]>;
  /** Sin carpeta instala global; con carpeta instala dentro de ella. */
  install(agentId: string, folder?: string): Promise<ManagedInstall[]>;
  forget(agentId: string, scope: "global" | "folder", folder: string | null): Promise<ManagedInstall[]>;
  chooseFolder(): Promise<string | undefined>;
}

const FORMAT_LABELS: Record<McpConfigFormat, string> = {
  "mcp-servers-json": "mcpServers (JSON)",
  "codex-toml": "Codex (TOML)",
  "vscode-json": "VS Code (JSON)",
  "zed-json": "Zed (JSON)",
  "opencode-json": "OpenCode (JSON)",
};

/**
 * Conectar un arnés es una sola decisión, no un formulario. La pantalla muestra
 * lo que hay en este equipo y dos formas de instalar; el servidor MCP y las
 * skills van siempre juntos porque la mitad de la instalación no sirve de nada:
 * sin MCP el agente no puede tocar la presentación, y sin skills no sabe cómo.
 *
 * Los arneses ausentes no aparecen. El catálogo completo respondía una pregunta
 * que nadie hizo y escondía las dos filas accionables entre diez inertes.
 */
export function AgentSetup({
  t,
  projectsRoot,
  busy = false,
  managed,
  detect,
  install,
  forget,
  chooseFolder,
}: AgentSetupProps) {
  const [agents, setAgents] = useState<DetectedAgent[]>();
  const [installs, setInstalls] = useState(managed);
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState<{ key: TranslationKey; tone: "ok" | "error" }>();
  const [format, setFormat] = useState<McpConfigFormat>("mcp-servers-json");
  const [copied, setCopied] = useState(false);

  const refresh = () => { void detect().then(setAgents).catch(() => setAgents([])); };
  useEffect(refresh, [detect]);
  useEffect(() => setInstalls(managed), [managed]);

  const folders = useMemo(() => installs.filter((entry) => entry.scope === "folder"), [installs]);

  const run = (agentId: string, scope: "global" | "folder", action: Promise<ManagedInstall[]>) => {
    setPending(`${agentId}:${scope}`);
    setMessage(undefined);
    void action
      .then((next) => {
        setInstalls(next);
        setMessage({ key: scope === "global" ? "agents.okGlobal" : "agents.okFolder", tone: "ok" });
        refresh();
      })
      .catch((caught: unknown) => {
        const reason = String(caught);
        setMessage({
          key: reason.includes("agent_not_installed")
            ? "error.agentMissing"
            : reason.includes("config")
              ? "error.agentConfig"
              : "error.agentInstall",
          tone: "error",
        });
      })
      .finally(() => setPending(undefined));
  };

  const installInFolder = (agentId: string) => {
    setMessage(undefined);
    void chooseFolder().then((folder) => {
      if (folder) run(agentId, "folder", install(agentId, folder));
    });
  };

  return (
    <div className="agents">
      <p className="panel__hint">{t("agents.intro")}</p>

      <section className="agents__group">
        <h4>{t("agents.detectedTitle")}</h4>
        {agents === undefined && <p className="panel__hint">{t("agents.detecting")}</p>}
        {agents?.length === 0 && <p className="panel__hint">{t("agents.none")}</p>}
        <ul>
          {agents?.map((agent) => (
            <li key={agent.id}>
              <div className="agents__identity">
                <strong>{t(`agents.${agent.id}` as const)}</strong>
                {agent.installed && <span className="badge badge--on">{t("agents.ready")}</span>}
              </div>
              <p className="agents__path">{agent.home}</p>
              <div className="agents__actions">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy || agent.installed || pending === `${agent.id}:global`}
                  onClick={() => run(agent.id, "global", install(agent.id))}
                >
                  <PackagePlus aria-hidden="true" />
                  {agent.installed ? t("agents.installedGlobal") : t("agents.installGlobal")}
                </button>
                {agent.supportsFolder && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy || pending === `${agent.id}:folder`}
                    onClick={() => installInFolder(agent.id)}
                  >
                    <FolderPlus aria-hidden="true" /> {t("agents.installFolder")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="agents__group">
        <h4>{t("agents.foldersTitle")}</h4>
        <p className="panel__hint">{t("agents.foldersHint")}</p>
        {folders.length === 0
          ? <p className="panel__hint">{t("agents.foldersEmpty")}</p>
          : (
            <ul className="agents__folders">
              {folders.map((entry) => (
                <li key={`${entry.agentId}:${entry.folder}`}>
                  <div>
                    <span>{entry.folder}</span>
                    <span className="badge badge--quiet">{t(`agents.${entry.agentId}` as const)}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("agents.forgetFolder")}
                    disabled={busy}
                    onClick={() => {
                      setMessage(undefined);
                      void forget(entry.agentId, "folder", entry.folder)
                        .then(setInstalls)
                        .catch(() => setMessage({ key: "error.agentInstall", tone: "error" }));
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      {message && (
        <p className={`agents__message ${message.tone === "error" ? "agents__message--error" : ""}`} role="status">
          {t(message.key)}
        </p>
      )}

      <details className="agents__manual">
        <summary>{t("agents.manualTitle")}</summary>
        <p className="panel__hint">{t("agents.manualHint")}</p>
        <SelectField
          label={t("agents.mcpFormat")}
          value={format}
          options={Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))}
          onValueChange={(value) => setFormat(value as McpConfigFormat)}
        />
        <label className="agents__snippet">
          <span className="field__label">{t("agents.mcpSnippet", { format: FORMAT_LABELS[format] })}</span>
          <textarea readOnly rows={9} value={manualSnippet(format, installs, projectsRoot)} spellCheck={false} />
        </label>
        <button
          type="button"
          className="button"
          onClick={() => {
            void navigator.clipboard?.writeText(manualSnippet(format, installs, projectsRoot)).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }).catch(() => setCopied(false));
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          {copied ? t("action.copied") : t("action.copy")}
        </button>
        <p className="panel__hint">{t("agents.mcpPrerequisites")}</p>
      </details>
    </div>
  );
}

/**
 * El fragmento para un cliente que el host no sabe detectar. La ruta real del
 * runtime se deduce de una instalación ya hecha; sin ninguna se muestra el
 * marcador, que enseña la forma exacta sin inventar una ruta que no existe.
 */
function manualSnippet(format: McpConfigFormat, installs: ManagedInstall[], projectsRoot: string): string {
  const runtime = installs.find((entry) => entry.runtimePath)?.runtimePath ?? "<DEKS_RUNTIME_PATH>";
  return mcpConfigSnippet(format, runtime, projectsRoot || "<DEKS_PROJECTS_ROOT>");
}
