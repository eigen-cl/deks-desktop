# The DEKS Core command envelope

Every command is an object with a kebab-case `type` and a camelCase payload flat on
the same object. Field names and value ranges are the document's own — see
`$deks-presentations` → `references/document-model.md` and `references/validation.md`.

`apply_commands` takes 1–100 of them and applies the whole array as **one** revision
and one undo step. If any command is invalid, nothing is applied.

Prefer one call for the coherent commands that compose a checkpoint or short
narration. Defining an identity, adding its state, placing its related elements and
setting their motion are normally one transaction, not one MCP call per command or
property. Continue from the revision returned by that transaction and use a new
semantic idempotency key for the next one. Render the completed checkpoint after the
batch, not between its commands.

```json
{
  "presentation_id": "propuesta-q3",
  "expected_revision": 12,
  "idempotency_key": "add-results-checkpoint-1",
  "commands": [ … ]
}
```

Only the outer call uses snake_case. Everything inside `commands` is camelCase.

## Document

```json
{"type": "update-document", "patch": {"name": "Propuesta Q3", "motionBeatMs": 600}}
```

`patch` accepts `name`, `motionBeatMs`, and a partial `palette`. A partial palette
merges role by role, so setting `primary` alone leaves the other five in place.

```json
{"type": "update-document", "patch": {"palette": {"primary": "#FF7043", "accent": "#65C18C"}}}
```

## Assets

Use the `add_asset` tool for image bytes: it validates PNG/JPEG/GIF/WebP up to
50 MB or canonicalizes a safe static SVG up to 5 MB, then embeds the admitted
bytes and declares the descriptor in one step. Every image is capped at 16,384
units per side and 40 megapixels of logical width × height. Safe SVG
has no scripts, CSS/fonts/`<text>`, `foreignObject`, nested `<image>`, `<use>`,
SMIL content or remote/data references. `define-asset` is only for a descriptor
whose exact admitted bytes are already present; it is never an upload or
validation bypass. `remove-asset` refuses to drop one that any state still
references.

```json
{"type": "remove-asset", "assetId": "a1b2c3"}
```

## Element identities

An identity carries no geometry. Declare it once, then give it state per slide.
In codec v2 a text identity also owns the fields that must never diverge between
slides.

```json
{"type": "define-element", "element": {
  "id": "story-title", "kind": "text", "name": "Título",
  "content": "Un trimestre que cambia el plan.", "fontFamily": "Poppins",
  "horizontalAlignment": "left", "verticalAlignment": "middle",
  "overflowMode": "hidden", "isLocked": false
}}
```

```json
{"type": "define-element", "element": {"id": "kpi-growth", "kind": "number", "name": "Crecimiento", "isLocked": false,
  "animateMagnitude": {"in": true, "morph": true, "out": false}}}
```

```json
{"type": "define-element", "element": {"id": "rule", "kind": "shape", "shapeKind": "line", "name": "Separador", "isLocked": false}}
```

Shapes also accept `shapeKind: "diamond"`.

```json
{"type": "update-element-identity", "elementId": "story-title", "patch": {"name": "Título del capítulo"}}
{"type": "update-element-identity", "elementId": "story-title", "patch": {"horizontalAlignment": "center"}}
{"type": "delete-element", "elementId": "story-title"}
```

`content`, `fontFamily`, `horizontalAlignment`, `verticalAlignment` and
`overflowMode` are text identity fields: an update changes every slide where the
identity appears. Use a new identity for different copy or a different semantic
text type. For fine positioning, keep alignment stable and patch state `x`/`y`
instead. `delete-element` removes the identity and every state it has anywhere.

## Slides

`create-slide` takes a whole slide object. Give it an empty `states` array and
compose afterwards; there is no "copy the previous checkpoint" flag here, so a new
slide starts exactly as you declare it.

```json
{"type": "create-slide", "afterSlideId": "contexto", "slide": {
  "id": "resultados", "name": "Resultados", "isTemplate": false,
  "background": {"kind": "linear-gradient", "startColor": "#0B0C0E", "endColor": "#171A21", "angleDeg": 120},
  "states": []
}}
```

```json
{"type": "update-slide", "slideId": "resultados", "patch": {"name": "Resultados del trimestre"}}
{"type": "reorder-slides", "slideIds": ["apertura", "contexto", "resultados", "cierre"]}
{"type": "delete-slide", "slideId": "resultados"}
```

`reorder-slides` needs the complete list, every existing slide exactly once. A
presentation always keeps at least one slide.

## Element states

This is where the composition actually happens.

```json
{"type": "add-element-state", "slideId": "resultados", "state": {
  "elementId": "story-title", "x": 80, "y": 188, "width": 920, "height": 224,
  "rotationDeg": 0, "opacity": 1, "zIndex": 4,
  "fontSize": 64, "fontWeight": 600,
  "lineHeight": 1.05, "letterSpacing": -1.4,
  "padding": {"top": 8, "right": 16, "bottom": 8, "left": 16},
  "fill": "#F2F1EC"
}}
```

Text `padding` is animatable state. All four non-negative sides are required when
present; omission means four zeros. It changes the inner text box, not the outer
geometry, anchor or snapping bounds.

A number state carries the magnitude and its complete formatting instead of text:

```json
{"type": "add-element-state", "slideId": "resultados", "state": {
  "elementId": "kpi-growth", "x": 980, "y": 300, "width": 420, "height": 180,
  "rotationDeg": 0, "opacity": 1, "zIndex": 4,
  "value": 38.5, "decimals": 1, "groupSeparator": ",", "decimalSeparator": ".",
  "symbol": "%", "symbolPosition": "after",
  "fontFamily": "Poppins", "fontSize": 120, "fontWeight": 600,
  "lineHeight": 1, "letterSpacing": -3,
  "horizontalAlignment": "left", "verticalAlignment": "middle",
  "overflowMode": "hidden", "fill": "#65C18C"
}}
```

Every state may include an optional normalized `anchor`:

```json
{"type": "add-element-state", "slideId": "resultados", "state": {
  "elementId": "decision", "x": 800, "y": 450, "width": 240, "height": 160,
  "anchor": {"x": 0.5, "y": 0.5},
  "rotationDeg": 12, "opacity": 1, "zIndex": 3,
  "shapeFill": {"kind": "solid", "color": "#FF7043"},
  "stroke": "#00000000", "strokeWidth": 0
}}
```

Both anchor coordinates are required and each is within `0..1`. `x` and `y`
identify that pivot; omit `anchor` to preserve legacy top-left positioning.

To **continue** an identity onto the next checkpoint, add another state for the same
`elementId` on that slide. That is what makes it morph. To change one already there:

```json
{"type": "update-element-state", "slideId": "resultados", "elementId": "kpi-growth", "patch": {"value": 41.2}}
{"type": "remove-element-state", "slideId": "resultados", "elementId": "kpi-growth"}
```

`remove-element-state` drops the element from that one checkpoint only; the identity
and its other states survive. A state rejects identity fields — `kind`, `name`,
`shapeKind` and friends belong to `update-element-identity`.

## Motion

`scope` says where the declaration lives; `role` is `in`, `out` or `morph`; `patch`
carries only the properties that change.

```json
{"type": "set-motion", "scope": {"kind": "document"}, "role": "in",
 "patch": {"animation": {"kind": "fade"}, "durationBeats": 1, "delayBeats": 0, "delayMs": 0, "easing": "ease-out"}}
```

The document scope must be complete — all five properties, for each of the three
roles. Everything below it is a patch:

```json
{"type": "set-motion", "scope": {"kind": "slide", "slideId": "resultados"}, "role": "in",
 "patch": {"durationBeats": 0.75}}
```

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "resultados", "elementId": "kpi-growth"}, "role": "in",
 "patch": {"animation": {"kind": "crop", "edge": "bottom"}, "durationBeats": 0.9, "delayBeats": 1.2, "easing": "ease-out"}}
```

Clearing removes the patch so the role inherits again. Omit `role` to clear all
three at that scope. The document scope cannot be cleared.

```json
{"type": "clear-motion", "scope": {"kind": "element", "slideId": "resultados", "elementId": "kpi-growth"}, "role": "in"}
```

## Translating from Cloud

If you have a Cloud batch in hand, the mapping is mechanical:

| Cloud command | Desktop equivalent |
|---|---|
| `create_element` | `define-element` **plus** `add-element-state` |
| `update_element_state` | `update-element-state` |
| `add_existing_element_state` | `add-element-state` with the same `elementId` |
| `remove_element_from_slide` | `remove-element-state` |
| `rename_element` | `update-element-identity` with `{"name": …}` |
| `delete_element` | `delete-element` |
| `create_slide` / `duplicate_slide` | `create-slide` (states declared explicitly) |
| `update_slide` | `update-slide` |
| `reorder_slides` / `delete_slide` | `reorder-slides` / `delete-slide` |
| `set_motion` / `clear_motion` | `set-motion` / `clear-motion` with an explicit `scope` |
| `set_presentation_motion_beat` | `update-document` with `{"motionBeatMs": …}` |
| `set_presentation_palette` | `update-document` with `{"palette": {…}}` |

And every snake_case field becomes camelCase: `duration_beats` → `durationBeats`,
`font_size` → `fontSize`, `shape_fill` → `shapeFill`, `symbol_position` →
`symbolPosition`, `animate_magnitude` → `animateMagnitude`. The nested `anchor`
object remains `{x, y}` on both hosts.
