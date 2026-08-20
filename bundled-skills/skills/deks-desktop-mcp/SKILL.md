---
name: deks-desktop-mcp
description: "Operate the local DEKS Desktop MCP over a project folder on disk: how the app connects an agent from Settings → Agents, the five tools it exposes (list_presentations, get_presentation, render_slide_preview, add_asset, apply_commands), the DEKS Core command envelope with kebab-case `type` and camelCase payloads, embedding image bytes with add_asset, expected revisions and idempotency keys, the folder lock and path_not_authorized, local visual QA in isolated Chromium, and the explicit list of Cloud capabilities that do not exist here. Use it whenever the discovered tool set is those five, whenever apply_commands takes `type` instead of `command`, or whenever the deck is a folder on the user's disk. Pair with $deks-presentations for the document contract itself."
---

# Operate the DEKS Desktop MCP

DEKS Desktop runs an MCP server on the user's machine over **one explicitly
authorized root folder**. Presentations never leave the disk and there is no token
and no account. A presentation is a folder holding `document.deks.json` plus an
`assets/` directory.

The document contract — what the fields mean and what values they take — lives in
`$deks-presentations`. This skill is only about reaching it through this server.

Read [references/commands.md](references/commands.md) for the exact envelope and a
worked example of every command you will actually send.

## How the user connects you

In the app: **Settings → Agents**. It lists the MCP clients already installed on the
machine — Claude Code and Claude Desktop, ChatGPT Desktop and Codex, Cursor,
Windsurf, Antigravity, VS Code, Zed, Continue, OpenCode, Gemini CLI — and offers
**Install global** or **Install in folder** for a single project. The app writes only
its own entry into that client's config, backing up the original first, and copies
the bundled skills alongside it. The user then restarts the client.

If the tools are missing, that is the fix: it is a client configuration step the user
performs in the app, not something to work around.

## The five tools

| Tool | Notes |
|---|---|
| `list_presentations()` | Valid local presentations inside the authorized root. Read-only. |
| `get_presentation(presentation_id)` | The canonical document and its current revision. Read-only. |
| `render_slide_preview(presentation_id, slide_id, expected_revision?, width?)` | Renders one slide with DEKS Core in isolated Chromium. Returns a PNG plus DOM measurements and visual-QA issues. `width` is `1280` or `1600`, default `1600`. Read-only. |
| `add_asset(presentation_id, expected_revision, idempotency_key, base64, original_filename?)` | Embeds raster bytes as an asset and declares it in the document. Returns the asset ID to reference from an image state. |
| `apply_commands(presentation_id, expected_revision, idempotency_key, commands)` | 1–100 DEKS Core commands applied as one local revision. |

That is the whole surface. Everything that mutates the deck goes through
`apply_commands`.

## The envelope is not the Cloud one

This is the single most common way to get it wrong. Cloud takes
`{"command": "create_element", "arguments": {...}}` with snake_case fields. Desktop
takes **DEKS Core commands**: a kebab-case `type` and a camelCase payload, flat on
the object.

```json
{"type": "add-element-state", "slideId": "s2", "state": {"elementId": "title", "x": 80, "y": 188, "…": "…"}}
```

The fifteen types are `update-document`, `define-asset`, `remove-asset`,
`define-element`, `update-element-identity`, `delete-element`, `create-slide`,
`update-slide`, `reorder-slides`, `delete-slide`, `add-element-state`,
`update-element-state`, `remove-element-state`, `set-motion`, `clear-motion`.

Note what that means in practice: there is no `create_element` that also places the
element. You `define-element` the identity, then `add-element-state` its state on a
slide — which is exactly the document model, made explicit.

## Assets

`add_asset` takes raw image bytes as base64. PNG, JPEG, GIF or WebP; **the media type
is decided by the bytes, not by what you declare**. It both stores the file under
`assets/` by content hash and declares the descriptor in the document, so you do not
also send `define-asset`. Use the returned asset ID in an image state's `assetId`.

Keep the batch and the asset separate: `add_asset` consumes a revision of its own.

## Writing safely

Each write takes `expected_revision` and an `idempotency_key` of 8–200 characters.
The store takes a lock on the project folder and writes the document atomically, so
a partially written file is not a state you have to handle. A batch is atomic: if any
command is invalid, nothing is applied and the revision does not advance.

`path_not_authorized` means the requested project resolves outside the root the user
authorized. That is not a retryable error and not something to route around: ask the
user to open or authorize that folder in the app.

For a timeout or transport error, the result is uncertain. Re-read with
`get_presentation` before touching the deck again — see `$deks-presentations` →
`references/recovery.md`.

## Visual QA

`render_slide_preview` here runs a real browser locally and returns the PNG together
with DOM measurements and detected issues. Trust the measurements only when the
report says they are available and the measured IDs cover the slide's rendered
element IDs. Render every checkpoint you touched at the freshly read revision, and
look at the images — the report catches overflow, not hierarchy, contrast, or whether
the motion means anything.

## What does not exist here

Do not call these; they belong to `$deks-cloud-mcp`:

`validate_layout` · `get_layout_snapshot` · `get_slide_state` · `list_assets` ·
`recommend_palettes` · `complete_palette` · `set_presentation_palette` ·
`list_icon_catalog` · `create_presentation` · `delete_presentation` ·
`create_slide` / `duplicate_slide` / `update_slide` / `reorder_slides` /
`delete_slide` as tools · `create_element` / `update_element_state` /
`add_existing_element_state` / `remove_element_from_slide` / `rename_element` /
`delete_element` as tools · `set_motion` / `clear_motion` /
`set_presentation_motion_beat` as tools · `undo_transaction` · `export_deck` ·
every publication tool.

The capabilities behind most of them still exist — as commands inside
`apply_commands`. The ones that genuinely do not exist locally are the palette
recommender, the icon catalog, geometry validation, undo, publication, and archive
export. Do not invent them, and do not tell the user a local deck can be published.

Creating a presentation is a user action in the app, not an MCP call. If there is no
project to work in, ask for one.
