# Desktop architecture

## Principle

DEKS is the language. Desktop is one host of that language.

```text
Tauri UI ───────────┐
                    ├─ Core command/codec ─ expected revision ─ atomic `.deks` replacement
Local MCP (stdio) ──┘                                                │
                                                                     └─ watcher event ─ UI rebase
```

Core remains deterministic and transport agnostic. Rust owns OS capabilities. The MCP executable
owns JSON-RPC transport but delegates document validation and mutation to `@deks-js/document`.

## Write protocol

1. Resolve one `.deks` file only inside an authorized root.
2. Acquire the transient sibling `.<name>.deks.lock` with exclusive creation.
3. Read and decode the archive again through `@deks-js/document`.
4. Compare its revision with `expectedRevision` and its archive fingerprint with the opened file.
5. Apply and validate the whole command batch in memory.
6. Assign exactly one new revision and repackage every embedded asset through the Core codec.
7. Sync a temporary file and atomically replace the `.deks` archive.
8. Write idempotency/activity only in `.<name>.deks.state/`, never into the strict portable manifest.
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

Serialized asset sources are embedded archive references or HTTPS references. Desktop reads an
image chosen by the person, packages its bytes into the same `.deks`, and resolves it to a short-lived
`blob:` URL that it revokes after use. Core never fetches a remote URL or reads a local path. The local
MCP accepts image bytes instead of paths and composes the published render-preview worker for
read-only PNG and DOM measurement QA; it does not duplicate the renderer. Missing bytes remain an
explicit `asset_unresolved` diagnostic.

Core owns the canonical policy. Desktop imports its released image helpers in both the WebView and
MCP instead of maintaining a host copy. Core types raster bytes, enforces the 50 MB / 16,384 px /
40 MP per-frame raster envelope, plus 200 frames and 100 MP aggregate, and parses SVG under the 5 MB
and bounded static-vector allowlist before returning deterministic sanitized bytes. Rust rejects a
physical `.deks` over 95 MB before reading it or crossing IPC; the WebView and MCP then enforce the
90 MB expanded limit using Core content hashes. A direct `.deks` open validates every embedded image
before the project becomes visible; a legacy asset is migrated only if it passes the same boundary.

`@deks-js/render-preview@4.2.0` admits the same canonical SVG bytes and renders them in its
network-blocked browser alongside raster assets. Desktop composes that released preview boundary;
it does not duplicate or patch the renderer locally.

## Legacy folders

An expanded `document.deks.json`/`assets/`/`changes/` folder can be selected only through the
explicit migration action. Desktop canonicalizes its document, resolves every embedded asset,
creates and reopens a neighboring `.deks`, and keeps the original folder unchanged. During the
transition MCP can still read legacy folders, but a neighboring `.deks` with the same document ID
takes precedence.
