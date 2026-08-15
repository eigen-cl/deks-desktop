# Desktop architecture

## Principle

DEKS is the language. Desktop is one host of that language.

```text
Tauri UI ───────────┐
                    ├─ Core command ─ expected revision ─ atomic folder write
Local MCP (stdio) ──┘                                      │
                                                           └─ watcher event ─ UI rebase
```

Core remains deterministic and transport agnostic. Rust owns OS capabilities. The MCP executable
owns JSON-RPC transport but delegates document validation and mutation to `@deks-js/document`.

## Write protocol

1. Resolve the project only inside an authorized root.
2. Acquire `project.lock` with exclusive creation.
3. Read the canonical document again under the lock.
4. Compare its revision with `expectedRevision`.
5. Apply and validate the whole command batch in memory.
6. Assign exactly one new revision.
7. Sync a temporary file and atomically replace `document.deks.json`.
8. Write a change receipt containing origin and affected identities.
9. Release the lock.

A repeated MCP idempotency key returns its original result. A stale expected revision fails with
`revision_conflict`; the system never silently chooses last-write-wins.

## Live updates

The watcher emits only after the canonical file changes. The frontend ignores duplicate/older
revisions, reloads the complete document and lets the editor reconcile active slide and selection by
ID. Local events include the full document on reload because no network transfer is involved.

## Assets

In the Core v2 contract, serialized asset sources are either packaged references or HTTPS references. `Blob` and
`Uint8Array` are facade inputs, not JSON values. A host-provided resolver converts a packaged asset
to a short-lived `blob:` URL and is responsible for revoking it. Core never fetches a remote URL.
The initial Desktop UI remains on the published v1 compatibility boundary and creates the local
`assets/` directory; asset ingestion and lifecycle resolution are intentionally not claimed by this
slice until document 0.3 is published and consumed.
