# DEKS Desktop

Local-first Tauri host for the open DEKS presentation format. A person and an AI agent can edit the
same presentation folder and see confirmed revisions appear in the editor without a Cloud account.

## What works in the first vertical slice

- Create or open a folder-backed DEKS presentation.
- Edit through a Desktop-native editor that executes the canonical DEKS Core commands and renderer.
- Compare `expectedRevision` before every write.
- Replace `document.deks.json` atomically under an interoperable `project.lock`.
- Keep assets and change receipts beside the document.
- Watch the canonical document and rebase the open editor after an external/MCP revision.
- Run a local stdio MCP with `list_presentations`, `get_presentation`, read-only
  `render_slide_preview`, transactional `apply_commands` and `add_asset`.
- Check for a signed update on launch, without blocking local work.
- Keep all runtime behavior local; there is no authentication or telemetry. The only outbound
  request is the explicit update check, and it can fail without affecting anything else.

Desktop and `deks-web` intentionally own different editor interfaces for their host environments.
Both consume the published Core document, commands and renderer directly, so a presentation remains
portable between them without sharing or vendoring either editor implementation.

## Project format

```text
my-presentation/
├── document.deks.json   # canonical editable presentation
├── assets/              # content-addressed local bytes
├── changes/             # revision and idempotency receipts
└── project.lock         # exists only during a write
```

`.deks` remains the portable ZIP used for import/export. Keeping the live project expanded avoids
rewriting every asset on drag, resize or agent command.

## Development

Node and Rust verification run in containers:

```bash
docker compose run --rm desktop npm run verify
docker compose run --rm rust cargo test --no-default-features
```

To open the native window, install the official Tauri prerequisites for your OS and run:

```bash
docker compose run --rm desktop npm run verify
npm run tauri dev
```

The second command is deliberately native because the window uses the host WebView and OS folder
picker. Project dependencies should still be installed and verified through Docker.

`docker compose run --rm tauri-check cargo check` additionally verifies the full Linux Tauri target;
it installs WebKitGTK in the image and therefore needs roughly 1 GB of free Docker storage.

Native installers and the release contract are documented in
[docs/releasing.md](docs/releasing.md). macOS releases are universal, signed and notarized; Windows
and Linux are compiled native packages and are not currently described as signed. Each public tag
uses stable installer filenames and publishes `latest.json` plus `SHA256SUMS.txt`; consumers can use
GitHub's `releases/latest/download/...` URLs without embedding a DEKS Desktop version.

## Bundled agent setup

The welcome screen can install two reviewed skills from `deks-plugin` 0.1.7:

- `deks-presentations`, the technical MCP and safety contract;
- `design-deks-presentations`, the story, visual-system, motion and QA method.

Choose the agent's existing `skills` parent directory explicitly. Desktop copies each complete skill
tree, including its relative references and agent metadata. It does not infer a home directory,
modify an agent configuration, follow bundled symlinks or overwrite a directory with the same skill
name. To update an existing installation, review/remove it yourself and run the installer again.

The same screen can install `deks-local-mcp` into an explicitly selected parent directory. That
payload includes the server, exact npm dependency lock and its own README, so it does not depend on a
source checkout. It deliberately does not embed a general-purpose Node runtime or a browser binary.
Install Node.js 22 or newer, then run from the installed `deks-local-mcp` directory:

```bash
npm ci --omit=dev
npm run install-browser
```

Configure the agent to execute `node /absolute/path/deks-local-mcp/mcp/server.mjs` and pass only the
explicit `DEKS_PROJECTS_ROOT`. This one-time setup needs network access to npm and Playwright's
Chromium download; normal local MCP use and preview rendering remain offline and browser network is
blocked. Desktop never stores tokens or adds MCP configuration automatically.

## Local MCP

Authorize one parent folder explicitly. Every direct child containing a valid
`document.deks.json` becomes visible to the server:

```json
{
  "mcpServers": {
    "deks-local": {
      "command": "node",
      "args": ["/absolute/path/to/deks-desktop/mcp/server.mjs"],
      "env": {
        "DEKS_PROJECTS_ROOT": "/absolute/path/to/my-deks-projects"
      }
    }
  }
}
```

Mutation tools require both `expected_revision` and an `idempotency_key`. The server resolves a
presentation by its document ID; tools never receive filesystem paths. It creates a receipt with
`origin: "agent"`, which the Tauri watcher turns into visible activity.

### Assets

Images live beside the document, in the project's `assets/` folder, named `<assetId>.<ext>`. The
extension is derived from the media type, so resolving an asset needs only the descriptor the
document already carries — never an absolute path. That is what lets a project folder be moved,
copied or zipped whole without breaking.

The media type is always decided by the file's own bytes, never by its extension or by what a caller
declares. A mislabelled file would enter the document with a lying `mediaType` and break wherever it
was opened next.

Desktop imports an image through the system file picker, which may point anywhere; the copy always
lands inside the project. Agents use `add_asset`, which takes base64 bytes and no path at all —
MCP only ever sees the authorized root, so accepting a path would hand it an arbitrary file reader.
Both paths write the bytes before declaring the descriptor, and withdraw orphan bytes if the
document rejects it, so a descriptor never points at a file that is not there.

`add_asset` registers the asset and returns its id. Placing it on a slide is a separate
`apply_commands` batch with `define-element` and `add-element-state` referencing that `assetId`.

### Visual QA

`render_slide_preview` accepts one `presentation_id`, one `slide_id`, a recommended optional
`expected_revision` and a bounded width (`1280` or `1600`). It renders the final settled slide at
DPR 1 with the canonical Core preview worker, blocks browser network access, and returns:

- one `image/png` content block;
- revision, slide name/index, canvas and render dimensions, byte size and SHA-256;
- Chromium DOM measurements for every element;
- deterministic issues for text overflow, elements outside the canvas and unresolved assets.

Embedded assets whose bytes exist are resolved from the project folder and rendered, so an agent can
see the image it just added. Only an asset whose bytes are genuinely missing is omitted and reported
as `asset_unresolved`.

The tool is read-only: it does not change the document revision, acquire the write lock, create a
receipt or accept paths, URLs or output commands. A result without deterministic overflow still
requires inspecting the returned PNG; geometry checks alone are not a visual approval.

The MCP needs the Chromium build matching Playwright. The Docker verification image already
contains it. For a native development checkout, install it once through the package script:

```bash
npm run mcp:install-browser
```

To import the current Web example into an already authorized projects root while working from this
repository:

```bash
mkdir -p "$DEKS_PROJECTS_ROOT/conoce-deks/assets" "$DEKS_PROJECTS_ROOT/conoce-deks/changes"
cp ../deks-web/apps/web/src/examples/decks/conoce-deks.deks.json \
  "$DEKS_PROJECTS_ROOT/conoce-deks/document.deks.json"
```

Open `$DEKS_PROJECTS_ROOT/conoce-deks` in the Desktop folder picker, or restart the local MCP and
call `list_presentations`, then call `render_slide_preview` once for each returned slide ID. The
example references `/brand/deks-lockup.svg`, which no asset in the project declares; the QA tool
omits that image and reports `asset_unresolved` instead of resolving a path or making a network
request. Add the bytes with `add_asset` and point the element at the returned id to see it render.

## Update channel

Desktop checks for a newer release on launch and offers it in a dismissible banner. Downloading is
always a decision of the person using the app, never a side effect of checking. `tauri-plugin-updater`
verifies the signature in Rust before installing, so an unsigned or tampered artifact is rejected even
if the manifest announces it.

Two manifests coexist and are not interchangeable:

- `latest.json` describes installers for a person choosing a download.
- `updater.json` describes signed update artifacts for the app, one entry per platform.

The channel stays off until its key pair exists, so a release without secrets still publishes
installers instead of announcing an update nobody can install. To turn it on, once:

```bash
npm run tauri -- signer generate -w ~/.deks/desktop-updater.key
```

Then store the private key as the `TAURI_SIGNING_PRIVATE_KEY` secret (plus
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set one), the public key as `TAURI_UPDATER_PUBKEY`, and
set the `DESKTOP_UPDATER_READY` repository variable to `true`. Keep the private key backed up: losing
it means existing installations can no longer verify a new release, and every user has to reinstall
by hand.

`src-tauri/tauri.conf.json` declares the endpoint; `src-tauri/tauri.updater.conf.json` is the overlay
CI merges to inject the real public key and request signed artifacts. `npm run release:validate`
fails if those two drift apart or if the placeholder key ever reaches the base config.

## Assets

Core owns the discriminated asset contract. A script can supply memory bytes/`Blob` or an HTTPS URL;
the serialized v2 document keeps a stable asset reference. Renderer Core receives only the resolved
render URL and never performs fetch, upload or filesystem work.

Desktop consumes exact published `@deks-js/document`, `@deks-js/renderer-core` and
`@deks-js/render-preview` packages. Its own editor writes only canonical Core commands, and its host
resolver turns embedded project assets into short-lived `blob:` URLs that are revoked after use.
The source tree never uses a relative `file:` dependency, vendors a private copy of Core or imports
the Web editor.

## Repository boundary

- `deks-core`: language/schema, commands, codecs, renderer and portable React.
- `deks-desktop`: folders, locks, watcher, local shell and MCP process.
- `deks-api`: relational Cloud persistence and remote MCP.
- `deks-web`: backendless Web editor and Cloud product.

License: Apache-2.0.
