# DEKS local MCP runtime

This directory is installed from DEKS Desktop. It contains the local stdio MCP server and an exact
dependency contract, so it does not depend on a DEKS source checkout.

Prerequisites:

- Node.js 22 or newer available to the agent host;
- network access during the one-time dependency and Chromium installation;
- one explicit parent folder to authorize as `DEKS_PROJECTS_ROOT`.

Install dependencies and the matching isolated Chromium build from this directory:

```bash
npm ci --omit=dev
npm run install-browser
```

Then configure the agent to launch `node /absolute/path/deks-local-mcp/mcp/server.mjs` with only
`DEKS_PROJECTS_ROOT=/absolute/path/to/my-deks-projects` in its MCP environment. Do not put tokens,
credentials, arbitrary command arguments or per-presentation paths in that configuration.

The runtime makes no Cloud requests. The preview browser blocks network access. Reinstall into a new
empty directory when upgrading; Desktop intentionally never overwrites a prior runtime.
