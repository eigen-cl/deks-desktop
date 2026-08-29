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
`DEKS_PROJECTS_ROOT=/absolute/path/to/my-deks-files` in its MCP environment. Every direct `*.deks`
file in that root becomes visible. Do not put tokens,
credentials, arbitrary command arguments or per-presentation paths in that configuration.

The runtime makes no Cloud requests. The preview browser blocks network access. Reinstall into a new
empty directory when upgrading; Desktop intentionally never overwrites a prior runtime.

`add_asset` accepts PNG, JPEG, GIF and WebP up to 50 MB, sanitized static SVG up to 5 MB, or
canonical MPEG-1 Layer III / PCM RIFF-WAV narration audio up to 50 MB and ten minutes. It validates
the real bytes before acquiring a project lock, then hashes and stores only the canonical bytes.
Use `set-slide-narration` and `clear-slide-narration` through `apply_commands`; no filesystem path
or caller-declared MIME enters either flow. The pinned Core preview renders visual assets without
allowing browser network access.
