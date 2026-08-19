# DEKS MCP tool map

Remote endpoint: `https://api-deks.eigen.cl/mcp/`

Public clients authenticate through the server's MCP OAuth flow. A direct development/CLI connection may instead send `Authorization: Bearer deks_pat_...`; PATs are workspace-bound, shown once, hashed at rest, revocable, and scoped to `read` and/or `write`. Never embed a PAT in a distributed plugin.

Treat the tools discovered from the server as the current source of truth. Review
their schemas plus `readOnlyHint`, `openWorldHint`, and `destructiveHint`
annotations before every release; do not rely on a hard-coded tool count.

## Read tools

- `list_presentations()` — list workspace decks and canonical revisions.
- `get_presentation(presentation_id)` — read the presentation, its ordered slides, element states, motion and current revision.
- `get_slide_state(presentation_id, slide_id)` — read one checkpoint and its typed states.
- `list_assets(limit?, cursor?)` — list workspace-scoped media newest first; `limit` defaults to `50` and accepts `1..100`, while `cursor` is an optional UUID copied verbatim from `next_cursor`. The result contains `items` and `next_cursor`; URLs are authenticated workspace paths and bytes are not embedded. Inspect this before asking the user to upload a file. The MCP does not upload assets.
- `get_layout_snapshot(presentation_id, slide_id)` — read absolute rectangles and deterministic geometry estimates. Treat estimated text bounds as conservative pre-render signals, never as browser measurements.
- `render_slide_preview(presentation_id, slide_id, expected_revision, width?)` — render one private checkpoint as a PNG (`width` is `1280` or `1600`) and return `layout_measurements_available`, renderer-derived `layout_measurements`, and `overflow_element_ids`. Always pass the freshly read revision. Use DOM measurements only when the availability flag is exactly `true` and their unique element ID set equals the freshly read slide's rendered element ID set. Missing, duplicate, or unexpected measurement IDs make coverage incomplete. Only complete coverage plus an empty overflow list supports a no-overflow conclusion. A false or absent flag is an image preview without DOM diagnostics, even if `layout_measurements` or `overflow_element_ids` is empty. Map reported overflow IDs back to semantic element names, correct them, re-read, and re-render until a compatible result confirms exact coverage and no overflow. The image is sent to the MCP client/model and is the basis for rendered QA, not a data-isolation mechanism.
- `validate_layout(presentation_id)` — return geometry-only errors and AABB collision/outside-canvas warnings based on authored bounds and estimates. It is not DOM measurement or rendered visual QA and currently has no semantic understanding of containment or z-order intent.
- `list_icon_catalog(family?, query?)` — discover trusted offline vector icons by semantic tags. `lucide` is the first family; results contain local path geometry, never remote URLs.
- `recommend_palettes(intent, mode?, limit?)` — recommend complete semantic palettes with measured contrast ratios. Apply role colors and their paired `on_colors` together rather than cherry-picking swatches.
- `complete_palette(intent?, mode?, background?, primary?, secondary?, reserve_semantic_colors?)` — preserve a valid supplied subset of `background`, `primary`, and `secondary`, then deterministically complete `primary`, `secondary`, `accent`, `background`, `text`, and `subtext` from the nearest catalog palette. The result includes `on_colors`, measured `contrast_checks`, `provided_roles`, `source_palette_id`, semantic `success`, `failure`, and `warning` colors, plus guidance. It infers mode from the background or defaults to dark. Its default reserves semantic colors; set `reserve_semantic_colors: false` only for a deliberate system that keeps status understandable another way. If fixed anchors cannot meet the contrast contract, the tool fails instead of silently changing them.
- `export_deck(presentation_id)` — return a portable `.deks` ZIP archive as base64. The server normally caps the final archive and total assets at 20 MB; never paste the base64 into chat.

## Presentation palette tool

- `set_presentation_palette(presentation_id, primary, secondary, accent, background, text, subtext, expected_revision, idempotency_key)` — replace all six default roles as one typed, reversible transaction. First select or complete a palette, review its contrast, then pass every returned role. Creating a presentation does not accept palette input: create it, capture revision `1`, then call this setter with that exact revision.

Inside `apply_commands`, use the operation `{"command":"set_presentation_palette","arguments":{"palette":{"primary":"#...","secondary":"#...","accent":"#...","background":"#...","text":"#...","subtext":"#..."}}}`. The outer batch supplies `expected_revision` and `idempotency_key`. The setter persists presentation defaults; restyle existing explicit slide and element colors separately when the selected system should change an existing deck.

## Slide tools

- `create_presentation(name, motion_beat_ms, expected_revision, idempotency_key, canvas?)` — create a presentation with one blank slide. `canvas` is the canonical `{width,height}` object. Use `expected_revision: 0` when this tool is present in the discovered server contract.
- `delete_presentation(presentation_id, expected_revision, confirmation_name)` — permanently delete the complete presentation history when this tool is present. It is intentionally non-idempotent and requires an explicit user deletion request, a fresh read, the exact revision, and exact presentation name.
- `create_slide(presentation_id, expected_revision, idempotency_key, after_slide_id?, copy_from_slide_id?, slide_id?)`
- `duplicate_slide(presentation_id, slide_id, expected_revision, idempotency_key)`
- `update_slide(presentation_id, slide_id, expected_revision, idempotency_key, name?, background?, is_template?)` — motion is a separate command.
- `reorder_slides(presentation_id, slide_ids, expected_revision, idempotency_key)`
- `delete_slide(presentation_id, slide_id, expected_revision, idempotency_key)`

`reorder_slides` requires the complete ordered list. `create_slide` copies the preceding checkpoint by default, including all element states. To scaffold a new deck safely, create every checkpoint while its predecessor is still blank, or pass an explicitly blank `copy_from_slide_id`; compose afterward. The MCP `create_presentation` input does not accept a palette; persist the default with `set_presentation_palette` immediately after creation, then use its roles consistently in slide and element states.

A presentation contains at most 50 checkpoints. This is an internal complexity guardrail, not normal user-facing copy: mention it only when it constrains planning or causes `resource_limit_reached`. `create_slide` and `duplicate_slide` return that code without mutation when the result would exceed the bound. Do not delete the oldest checkpoint automatically and do not split a narrative silently; ask the user to shorten or intentionally divide the deck.

## Element tools

- `create_element(...)` — create a stable identity and its state on one slide. Required geometry is `x`, `y`, `width`, and `height`; `kind` is `text`, `number`, `image`, `shape`, `group`, `link-button`, or `icon`.
- `update_element_state(...)` — replace one slide-local state without changing other checkpoints.
- `add_existing_element_state(presentation_id, target_slide_id, source_slide_id, element_id, expected_revision, idempotency_key, x?, y?)` — continue a stable identity onto another slide.
- `remove_element_from_slide(...)` — remove only one checkpoint state.
- `rename_element(...)` — rename an identity across every slide.
- `delete_element(...)` — delete the identity and every checkpoint state.

Images require an existing `asset_id`. Shapes require `shape_kind`: `rectangle`, `ellipse`, or `line`. `shape_fill` accepts either:

```json
{"kind":"solid","color":"#FF7043"}
```

or:

```json
{"kind":"linear-gradient","start_color":"#FF7043","end_color":"#0B0C0E","angle_deg":135}
```

Lines use `stroke` and a solid transparent `shape_fill`, never a gradient. A `link-button` requires a label and a safe absolute HTTPS URL. The current MCP does not expose group parent/child editing.

A `number` carries a magnitude, not a string of digits, so it has no `content`. Its state declares `value` plus the complete formatting the document renders it with: `decimals` (0 to 6), `group_separator` (`""`, `","`, `"."`, `" "` or `"'"`), `decimal_separator` (`"."` or `","`), `symbol` (up to 8 characters, `""` for none) and `symbol_position` (`before` or `after`). It takes the same typography as text. Formatting is never resolved from a locale: the document says exactly which separators to use, so the same file renders the same digits everywhere.

Its identity carries `animate_magnitude`, three booleans naming which roles count towards the value:

```json
{"command":"create_element","arguments":{"kind":"number","value":38.5,"decimals":1,"symbol":"%","symbol_position":"after","group_separator":",","decimal_separator":".","animate_magnitude":{"in":true,"morph":true,"out":false}}}
```

Entering counts up from zero, leaving counts down to zero, and a morph counts between the two checkpoints' values on that role's own duration and easing. The toggles live on the identity, not on a state: whether a figure is the kind of figure that counts is decided once. A cut, a zero duration and reduced motion all land on the final value immediately.

An `icon` requires a catalog-backed `icon_family` and `icon_name`; use its normal element `color` for the glyph. Query the catalog by meaning first, keep the icon offline, and never paste arbitrary SVG or fetch an icon URL at render time. Treat icon identity changes as discrete between checkpoints; position, scale, rotation, opacity, and color may still animate through the stable element identity.

Each checkpoint contains at most 100 rendered element states; a shared identity counts once on each checkpoint where it has state. This is also an internal guardrail: surface it only when it conditions or rejects the task. `create_element` and `add_existing_element_state` return `resource_limit_reached` without mutation when they would exceed the bound. An atomic `apply_commands` batch that crosses either content limit rolls back completely with its revision unchanged. Undo also validates the restored state before writing. There is no secondary plan-specific cap on the total identities in a presentation.

## Publication tools

- `get_presentation_publication(presentation_id)` — read publication state. An unpublished deck returns `{"published":false}`.
- `publish_presentation(presentation_id, expected_revision, idempotency_key)` — expose the current live presentation at a non-enumerable public link and return its `public_id`, `url`, publication timestamp, and actor ID.
- `rotate_presentation_publication(presentation_id, expected_revision, idempotency_key)` — immediately revoke the prior public ID and issue a new link.
- `unpublish_presentation(presentation_id, expected_revision, idempotency_key)` — immediately revoke public access and return `{"published":false}`.

Publishing is an external state change and does not create a snapshot: the public link shows the deck's current revision. Publish, rotate, or unpublish only on an explicit user request, re-read immediately beforehand, and never retry an uncertain external mutation blindly. `unpublish_presentation` is annotated destructive.

## Motion and history tools

- `set_presentation_motion_beat(presentation_id, motion_beat_ms, expected_revision, idempotency_key)`
- `set_motion(presentation_id, role, expected_revision, idempotency_key, slide_id?, element_id?, animation?, duration_beats?, delay_ms?, easing?)` — `role` is `in`, `out` or `morph`. Without `slide_id` it writes the presentation default and every property is required. With `slide_id`, and optionally `element_id`, it writes a patch: only the properties you pass change, the rest stay inherited.
- `clear_motion(presentation_id, role, slide_id, expected_revision, idempotency_key, element_id?)` — drop a slide or element patch so the role inherits again. The presentation scope cannot be cleared: it is the value everything else inherits.
- `apply_commands(presentation_id, commands, expected_revision, idempotency_key)` — apply 1–100 typed operations atomically as one revision and undo step. `update_slide` and `set_presentation_motion_beat` are not batch commands.
- `undo_transaction(presentation_id, expected_revision, idempotency_key, transaction_id?)`

Each role also carries two delays that **add**: `delay_beats` is a multiple of `motion_beat_ms`, so "start when the previous animation ends" is `delay_beats: 1` and stays true when the deck's tempo changes; `delay_ms` is absolute, for an offset that is about a specific instant. Both default to `0`. The wait is `motion_beat_ms * delay_beats + delay_ms`.

`animation` is one object, discriminated by `kind`:

- `{"kind": "none"}` and `{"kind": "fade"}` for `in` and `out`;
- `{"kind": "slide", "edge": "left|right|top|bottom", "distance": 240}` — without `distance` the element travels completely off the canvas;
- `{"kind": "crop", "edge": "left|right|top|bottom"}` — the element's own rectangle masks it and the content travels inside it, so the box never moves and opacity is never touched. It takes no `distance`: the travel is exactly the element's own extent on that axis;
- `{"kind": "wipe", "edge": "left|right|top|bottom"}` — the opposite: the element does not move at all and the mask edge travels across it, uncovering it on the way in and covering it again on the way out. Also no `distance`;
- `{"kind": "scale", "from": 0.8}`;
- `{"kind": "morph"}` or `{"kind": "cut"}` for the `morph` role only.

`duration_beats` is a multiple of `motion_beat_ms` between 0 and 8; `delay_ms` is real milliseconds up to 60000. `easing` is `linear`, `ease-in`, `ease-out`, `ease-in-out`, or four cubic-bezier controls `[x1,y1,x2,y2]` with x between 0 and 1.

## Exact batch envelope

Each operation is strict:

```json
{
  "command": "create_element",
  "arguments": {
    "slide_id": "target-slide-id",
    "kind": "text",
    "name": "Hero title",
    "content": "A claim",
    "x": 100,
    "y": 80,
    "width": 900,
    "height": 100
  }
}
```

- Put `slide_id` inside `arguments` for `create_element`.
- Put `slide_id` and `element_id` beside `command` for `update_element_state`, `remove_element_from_slide`, and `add_existing_element_state`; the latter puts `source_slide_id` in `arguments`.
- Put `slide_id`, and when needed `element_id`, beside `command` for `set_motion` and `clear_motion`; `role` goes in `arguments`.
- Put `expected_revision` and `idempotency_key` only on the outer `apply_commands` call.
- A failed batch rolls back every operation. A timeout or transport error is an uncertain result; re-read before retrying.

## Current capability boundaries

At package release time, verify capability boundaries against the MCP discovery result. A compatible server exposes workspace asset listing, rendered slide previews with `layout_measurements_available`, DOM `layout_measurements`, and `overflow_element_ids`, plus offline icon discovery, palette recommendations, and anchored palette completion. Do not silently fall back to geometric estimates if any preview diagnostic field is unavailable or coverage is incomplete; report the reduced QA level. Asset upload, `.deks` import, PPTX export, native speaker notes, and source metadata remain web-app or future-server workflows. Use visible text for source notes and `export_deck` for portable `.deks` output when the discovered server exposes it.
