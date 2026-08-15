# DEKS Desktop

Local-first Tauri host for the open DEKS presentation format. A person and an AI agent can edit the
same presentation folder and see confirmed revisions appear in the editor without a Cloud account.

## What works in the first vertical slice

- Create or open a folder-backed DEKS presentation.
- Edit through the portable `@deks-js/react` editor.
- Compare `expectedRevision` before every write.
- Replace `document.deks.json` atomically under an interoperable `project.lock`.
- Keep assets and change receipts beside the document.
- Watch the canonical document and rebase the open editor after an external/MCP revision.
- Run a local stdio MCP with `list_presentations`, `get_presentation` and transactional
  `apply_commands`.
- Keep all runtime behavior local; there is no authentication, telemetry or network client.

The initial portable editor intentionally exposes fewer inspectors than the mature editor in
`deks-web`. Desktop composes published Core packages and gains features as those packages reach
parity; it never vendors the Web editor.

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

## Assets

Core owns the discriminated asset contract. A script can supply memory bytes/`Blob` or an HTTPS URL;
the serialized v2 document keeps a stable asset reference. Renderer Core receives only the resolved
render URL and never performs fetch, upload or filesystem work.

The first Desktop source slice creates the `assets/` directory but does not yet expose an asset
import UI or resolver. It consumes the published `@deks-js/document` 0.3 and `@deks-js/react` 0.4
packages while the editor surface remains on the compatible v1 document API. Asset ingestion and
the v2 host resolver are the next Desktop integration boundary. The source tree never uses a
relative `file:` dependency or vendors a private copy of Core.

## Repository boundary

- `deks-core`: language/schema, commands, codecs, renderer and portable React.
- `deks-desktop`: folders, locks, watcher, local shell and MCP process.
- `deks-api`: relational Cloud persistence and remote MCP.
- `deks-web`: backendless Web editor and Cloud product.

License: Apache-2.0.
