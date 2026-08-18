import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, PackagePlus, ServerCog } from "lucide-react";
import { groupAgents, mcpConfigSnippet } from "../agents";
import type { DetectedAgent, ManagedMcp, McpConfigFormat } from "../model";
import { SelectField } from "../ui/fields";
import type { Translate } from "../i18n";

export interface AgentSetupProps {
  t: Translate;
  /** Carpetas que el MCP puede autorizar. La primera es la raíz por defecto. */
  roots: string[];
  busy?: boolean;
  detect(): Promise<DetectedAgent[]>;
  installSkills(agentId: string): Promise<unknown>;
  installSkillsInFolder(): Promise<unknown>;
  installMcp(): Promise<ManagedMcp>;
}

const FORMAT_LABELS: Record<McpConfigFormat, string> = {
  "mcp-servers-json": "mcpServers (JSON)",
  "codex-toml": "Codex (TOML)",
  "vscode-json": "VS Code (JSON)",
  "zed-json": "Zed (JSON)",
  "opencode-json": "OpenCode (JSON)",
};

/**
 * Instalación para agentes. Detecta qué hay en el equipo y agrupa a los que se
 * configuran igual, porque la diferencia entre Cursor y Windsurf no es el
 * formato sino dónde vive el archivo.
 *
 * Las skills se copian; la configuración MCP no. DEKS nunca escribe dentro del
 * archivo de otro programa —fusionar a ciegas puede romper conexiones que ya
 * existían— así que entrega el fragmento exacto y la ruta donde pegarlo.
 */
export function AgentSetup({ t, roots, busy = false, detect, installSkills, installSkillsInFolder, installMcp }: AgentSetupProps) {
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [format, setFormat] = useState<McpConfigFormat>("mcp-servers-json");
  const [configPath, setConfigPath] = useState<string>();
  const [root, setRoot] = useState(roots[0] ?? "");
  const [runtime, setRuntime] = useState<ManagedMcp>();
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);

  const refresh = () => { void detect().then(setAgents).catch(() => setAgents([])); };
  useEffect(refresh, [detect]);
  useEffect(() => { if (!root && roots[0]) setRoot(roots[0]); }, [root, roots]);

  const groups = useMemo(() => groupAgents(agents), [agents]);
  // Antes de instalar y de elegir carpeta el fragmento ya se ve, con marcadores
  // evidentes: enseña la forma exacta sin fingir una ruta que todavía no existe.
  const snippet = mcpConfigSnippet(format, runtime?.path ?? "<DEKS_RUNTIME_PATH>", root || "<DEKS_PROJECTS_ROOT>");

  const install = (action: Promise<unknown>, ok: string) => {
    setMessage(undefined);
    void action
      .then(() => { setMessage(ok); refresh(); })
      .catch((caught: unknown) => {
        const reason = String(caught);
        setMessage(t(reason.includes("skill_already_exists")
          ? "error.skillsExist"
          : reason.includes("agent_not_installed")
            ? "error.agentMissing"
            : "error.skills"));
      });
  };

  return (
    <div className="agents">
      <p className="panel__hint">{t("agents.intro")}</p>

      {groups.map(({ group, agents: members }) => (
        <section key={group} className="agents__group">
          <h4>{t(`agents.group.${group}` as const)}</h4>
          <ul>
            {members.map((agent) => (
              <li key={agent.id} className={agent.home ? "is-detected" : ""}>
                <div className="agents__identity">
                  <strong>{t(`agents.${agent.id}` as const)}</strong>
                  <span className={`badge ${agent.home ? "badge--on" : ""}`}>
                    {agent.home ? t("agents.detected") : t("agents.missing")}
                  </span>
                  {agent.skillsInstalled && <span className="badge badge--quiet">{t("agents.skillsInstalled")}</span>}
                </div>
                {agent.configPath && <p className="agents__path">{t("agents.configPath", { path: agent.configPath })}</p>}
                <div className="agents__actions">
                  {agent.skillsPath && (
                    <button
                      type="button"
                      className="button"
                      disabled={busy || !agent.home || agent.skillsInstalled}
                      onClick={() => install(installSkills(agent.id), t("ok.skills"))}
                    >
                      <PackagePlus aria-hidden="true" /> {t("agents.installGlobal")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      setFormat(agent.format);
                      setConfigPath(agent.configPath ?? undefined);
                    }}
                  >
                    <ServerCog aria-hidden="true" /> {t("agents.mcpTitle")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="panel__hint">{t("agents.folderHint")}</p>
      <button type="button" className="button agents__folder-action" disabled={busy} onClick={() => install(installSkillsInFolder(), t("ok.skills"))}>
        <PackagePlus aria-hidden="true" /> {t("agents.installFolder")}
      </button>

      <section className="agents__mcp">
        <h4>{t("agents.mcpTitle")}</h4>
        <p className="panel__hint">{t("agents.mcpIntro")}</p>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => {
            setMessage(undefined);
            void installMcp()
              .then((installed) => {
                setRuntime(installed);
                setMessage(installed.installed ? t("ok.mcp") : t("agents.mcpAlready"));
              })
              .catch(() => setMessage(t("error.mcp")));
          }}
        >
          <ServerCog aria-hidden="true" /> {t("agents.mcpInstall")}
        </button>
        {runtime && <p className="agents__path">{t("agents.mcpInstalledAt", { path: runtime.path })}</p>}

        <div className="agents__mcp-fields">
          <SelectField
            label={t("agents.mcpFormat")}
            value={format}
            options={Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))}
            onValueChange={(value) => setFormat(value as McpConfigFormat)}
          />
          <SelectField
            label={t("agents.mcpRoot")}
            value={root}
            options={roots.map((path) => ({ value: path, label: path }))}
            onValueChange={setRoot}
          />
        </div>

        <label className="agents__snippet">
          <span className="field__label">{t("agents.mcpSnippet", { format: FORMAT_LABELS[format] })}</span>
          <textarea readOnly rows={9} value={snippet} spellCheck={false} />
        </label>
        <div className="agents__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              void navigator.clipboard?.writeText(snippet).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }).catch(() => setCopied(false));
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
            {copied ? t("action.copied") : t("action.copy")}
          </button>
        </div>
        <p className="panel__hint">{t("agents.mcpWriteHint", { path: configPath ?? t("agents.mcpFormat") })}</p>
        <p className="panel__hint">{t("agents.mcpPrerequisites")}</p>
      </section>

      {message && <p className="agents__message" role="status">{message}</p>}
    </div>
  );
}
