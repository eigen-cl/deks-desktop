---
name: deks-desktop-mcp
description: "Operate the local DEKS Desktop MCP over portable `.deks` files on disk: how the app connects an agent from Settings → Agents, the five tools it exposes (list_presentations, get_presentation, render_slide_preview, add_asset, apply_commands), the DEKS Core command envelope with kebab-case `type` and camelCase payloads, embedding image or narration audio bytes with add_asset, expected revisions and idempotency keys, the sibling file lock and path_not_authorized, local visual QA in isolated Chromium, and the explicit list of Cloud capabilities that do not exist here. Use it whenever the discovered tool set is those five, whenever apply_commands takes `type` instead of `command`, or whenever the deck is a local `.deks` file. Pair with $deks-presentations for the document contract itself."
---

# Operate the DEKS Desktop MCP

DEKS Desktop runs an MCP server on the user's machine over **one explicitly
authorized root folder**. Presentations never leave the disk and there is no token
and no account. A presentation is one direct `.deks` file whose strict manifest and
embedded assets are read and written by `@deks-js/document`.

The current portable manifest is codec v3 (`codecVersion: 3`). Desktop decodes
an unmarked or explicit v1 file through Core's v1 → v2 → v3 migration, and v2
through v2 → v3, before exposing
it, using the first state in slide order when legacy fixed text fields conflict.
Writes always persist v3; a future codec version is rejected rather than guessed.

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
| `add_asset(presentation_id, expected_revision, idempotency_key, base64, original_filename?)` | Admits image or WAV/MP3 narration bytes, embeds their canonical form and declares the asset. Returns the asset ID to reference from an image state or slide narration. |
| `apply_commands(presentation_id, expected_revision, idempotency_key, commands)` | 1–100 DEKS Core commands applied as one local revision. |

That is the whole surface. Everything that mutates the deck goes through
`apply_commands`.

## Keep client round trips semantic

Do not call `apply_commands` once per element or property. Group the identities,
states, styling and motion that complete one coherent checkpoint or short narration
into one atomic batch of at most 100 commands. Keep assets in their required
`add_asset` transactions and keep unrelated, destructive or scene-independent work
out of a batch merely to reduce calls.

Read before the first transaction. After a confirmed batch, use its returned
revision as the next batch's `expected_revision` and issue a new semantic
`idempotency_key`. Re-read on conflicts and uncertain responses; latency reduction
never permits guessed revisions or reused keys for different payloads.

Render the coherent checkpoint or narration after its batch commits, not after each
property. Re-render the affected checkpoint after correction batches and inspect the
whole ordered sequence at the final confirmed revision.

## The envelope is not the Cloud one

This is the single most common way to get it wrong. Cloud takes
`{"command": "create_element", "arguments": {...}}` with snake_case fields. Desktop
takes **DEKS Core commands**: a kebab-case `type` and a camelCase payload, flat on
the object.

```json
{"type": "add-element-state", "slideId": "s2", "state": {"elementId": "title", "x": 80, "y": 188, "…": "…"}}
```

The seventeen types are `update-document`, `define-asset`, `remove-asset`,
`define-element`, `update-element-identity`, `delete-element`, `create-slide`,
`update-slide`, `reorder-slides`, `delete-slide`, `add-element-state`,
`update-element-state`, `remove-element-state`, `set-motion`, `clear-motion`,
`set-slide-narration`, `clear-slide-narration`.

Note what that means in practice: there is no `create_element` that also places the
element. You `define-element` the identity, then `add-element-state` its state on a
slide — which is exactly the document model, made explicit.

For text, `define-element` owns `content`, `fontFamily`, both alignments and
`overflowMode`; `add-element-state` owns continuous typography, colour and optional
four-sided padding. Different content or semantic text types need different
identities. For a fine visual adjustment keep alignment fixed and update `x`/`y`
or padding on the state.

## Assets

`add_asset` takes raw asset bytes as base64. It accepts PNG, JPEG, GIF or WebP up
to 50 MB, or a static safe SVG up to 5 MB. Every image is at most 16,384 units on
either side and its logical width × height is at most 40 megapixels. **The media
type is decided by the bytes, not by what you declare.**

For slide narration it also accepts canonical `audio/wav` integer PCM (16/24
bit) or frame-only `audio/mpeg` MPEG-1 Layer III, at most 50 MB and 10 minutes,
with 1–2 channels at 8–48 kHz. Recorded Desktop audio normally arrives as mono
24 kHz/16-bit WAV. Do not send browser WebM/MP4 capture bytes, ID3 metadata,
filesystem paths or remote audio URLs.

Safe SVG means DEKS's parsed subset, not arbitrary markup: no scripts, events,
CSS/style, fonts or `<text>`, `foreignObject`, nested `<image>`, `<use>`, SMIL,
extra namespaces, declarations/entities/processing instructions, or remote/data
references. The host emits canonical UTF-8 SVG before hashing and embedding it.

`add_asset` packages the admitted bytes in the same `.deks` by content hash and
declares the descriptor, so you do not also send `define-asset`. Use the returned
asset ID in an image state's `assetId` or a narration's `audio.assetId`. Never send uninspected bytes through
`define-asset`; it only describes bytes that are already present.

Keep the batch and the asset separate: `add_asset` consumes a revision of its own.
The complete portable file is capped at 95 MB physical and 90 MB uncompressed;
these are file-safety bounds, not a Cloud plan quota.

## Writing safely

Each write takes `expected_revision` and an `idempotency_key` of 8–200 characters.
The store takes a transient sibling `.<name>.deks.lock` and replaces the archive
atomically, so a partially written file is not a state you have to handle. Idempotency
and activity receipts live in `.<name>.deks.state/`, never in the portable manifest.
A batch is atomic: if any
command is invalid, nothing is applied and the revision does not advance.

`path_not_authorized` means a discovered file or hidden state path resolves outside
the root the user authorized. That is not retryable and not something to route around:
ask the user to move the `.deks` into or authorize the intended root in the app.

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

“Every checkpoint” is the QA coverage target, not a request to render between
individual commands. Compose a checkpoint coherently in `apply_commands`, then
render it once at the returned revision; render it again only after a correction.

The Desktop runtime pins the exact `@deks-js/render-preview` version declared by its bundled MCP and
renders both admitted raster images and canonical safe SVG from the embedded
`.deks` assets. Do not replace an embedded image with a filesystem path or remote
URL.

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
`apply_commands`. Desktop's bundled Core validates and renders the complete pinned
Lucide 1.34.0 family offline, but Desktop does not expose `list_icon_catalog`: an
agent cannot search or page icon names through the local MCP. The capabilities that
genuinely do not exist locally are palette recommendation, icon-catalog discovery,
geometry validation, undo, publication, and archive export. Do not invent them, and
do not tell the user a local deck can be published.

Creating a presentation is a user action in the app, not an MCP call. If there is no
project to work in, ask for one.
