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

## Editor ownership

Desktop and Web own different editor implementations suited to their hosts. Desktop never vendors
the Web editor; both execute the same released Core command and document contracts and use the Core
renderer. That shared language, rather than a shared editor component, is the portability boundary.

## Assets

Serialized asset sources are embedded project references or HTTPS references. Desktop imports an
image into the project's `assets/` folder, records its Core descriptor and resolves it to a
short-lived `blob:` URL that it revokes after use. Core never fetches a remote URL or reads a local
path. The local MCP accepts image bytes instead of paths and composes the published render-preview
worker for read-only PNG and DOM measurement QA; it does not duplicate the renderer. Missing bytes
remain an explicit `asset_unresolved` diagnostic.
