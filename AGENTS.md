# AGENTS.md — DEKS Desktop

## Scope

This repository is the local Tauri host for the open DEKS format. It owns OS dialogs, authorized
folders, atomic persistence, local activity and the optional stdio MCP process. It does not own the
document schema, renderer, editing commands, Cloud authentication or remote collaboration.

## Architecture

- Consume released, exact `@deks-js/*` packages. Do not copy Core implementation into this repo.
- `document.deks.json` is canonical while a project is open; `.deks` ZIP is an interchange artifact.
- Every mutation uses `expectedRevision`, an interoperable lock and atomic replacement.
- MCP sees only the explicit `DEKS_PROJECTS_ROOT`; never accept arbitrary absolute paths as tool input.
- Installing into a harness is the one sanctioned write into another program's files, and only from
  an explicit click. Merge the `deks` entry alone, preserve every other key, and back the original
  file up beside itself before the first write. Never store credentials there.
- MCP and skills install together or not at all: half an installation cannot do the job.
- Only detected harnesses reach the screen; managed folders are re-synced on update, and a folder
  that disappeared is dropped instead of recreated.
- The local app and MCP never require an account and must not make network requests.
- Runtime `blob:` URLs belong to the host and must be revoked; persisted remote assets are HTTPS only.

## Quality

- Write integration/contract tests before important flows.
- Run Node and Rust dependencies/tests through Docker.
- Preserve keyboard access, 44 px targets and `prefers-reduced-motion`.
- Do not publish, sign, notarize or update external client configuration without explicit authorization.
