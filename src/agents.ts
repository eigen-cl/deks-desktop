import type { DetectedAgent, McpConfigFormat } from "./model";

/**
 * Fragmento de configuración MCP por formato. DEKS nunca escribe dentro de la
 * configuración de otro programa —fusionar TOML o JSON ajeno a ciegas puede
 * romper conexiones que la persona ya tenía— así que genera el texto exacto y
 * ella lo pega. El fragmento no contiene credenciales: el MCP local no las usa.
 */
export function mcpConfigSnippet(
  format: McpConfigFormat,
  runtimePath: string,
  projectsRoot: string,
): string {
  const command = "node";
  const script = `${runtimePath}/mcp/server.mjs`;
  const env = { DEKS_PROJECTS_ROOT: projectsRoot };

  if (format === "codex-toml") {
    return [
      "[mcp_servers.deks]",
      `command = ${JSON.stringify(command)}`,
      `args = [${JSON.stringify(script)}]`,
      "",
      "[mcp_servers.deks.env]",
      `DEKS_PROJECTS_ROOT = ${JSON.stringify(projectsRoot)}`,
    ].join("\n");
  }

  if (format === "vscode-json") {
    return stringify({ servers: { deks: { type: "stdio", command, args: [script], env } } });
  }

  if (format === "zed-json") {
    return stringify({ context_servers: { deks: { source: "custom", command, args: [script], env } } });
  }

  if (format === "opencode-json") {
    return stringify({
      mcp: { deks: { type: "local", command: [command, script], enabled: true, environment: env } },
    });
  }

  return stringify({ mcpServers: { deks: { command, args: [script], env } } });
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export const AGENT_GROUPS = ["claude", "openai", "editors", "cli"] as const;
export type AgentGroup = (typeof AGENT_GROUPS)[number];

/**
 * Agrupa los agentes por familia y deja arriba los que sí están instalados: la
 * lista completa sirve de catálogo, pero lo accionable va primero.
 */
export function groupAgents(agents: DetectedAgent[]): Array<{ group: AgentGroup; agents: DetectedAgent[] }> {
  return AGENT_GROUPS.map((group) => ({
    group,
    agents: agents
      .filter((agent) => agent.group === group)
      .sort((left, right) => Number(Boolean(right.home)) - Number(Boolean(left.home))),
  })).filter(({ agents: members }) => members.length > 0);
}
