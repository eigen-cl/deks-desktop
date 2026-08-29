# The DEKS document model

Field names are given in the canonical document's camelCase. The Cloud MCP takes
the same fields in snake_case; the Desktop MCP takes them exactly as written here.
`$deks-cloud-mcp` and `$deks-desktop-mcp` give the exact spelling per host.

## Document

| Field | Meaning |
|---|---|
| `format` | Always `"deks"`. |
| `codecVersion` | Current portable output is `3`. Missing or `1` migrates v1 → v2 → v3; explicit `2` migrates v2 → v3; a future version is rejected. |
| `id`, `name`, `revision` | Identity and the monotonic revision every write declares. |
| `canvas` | `{width, height}` in canvas units. Every geometry below is in those units, not pixels. |
| `motionBeatMs` | The deck's tempo. Every duration and musical delay is a multiple of it. |
| `motion` | The complete three-role declaration everything else inherits from. |
| `palette` | Six semantic roles: `primary`, `secondary`, `accent`, `background`, `text`, `subtext`. |
| `assets` | Declared asset descriptors. An image state or slide narration references one by `assetId`. |
| `elements` | The identities: `id`, `kind`, `name`, optional logical `parentId`, `isLocked`; for text its fixed `content`, `fontFamily`, `horizontalAlignment`, `verticalAlignment`, `overflowMode`; for a shape its `shapeKind`; for a number its `animateMagnitude`. |
| `slides` | The ordered checkpoints. |

There is no transitions array. A boundary is simply two adjacent slides, and each
element's role at that boundary follows from which of the two it has a state on.

### Logical element groups

A named identity with `kind: "group"` is a logical folder. An element belongs to
it when the element identity's `parentId` references that group; groups may be
nested and the parent graph is acyclic. Grouping never changes a member's
geometry, style, z-order or motion: every state remains absolute canvas data.
A logical group needs no slide state and does not render or transform descendants.

Collision diagnostics first resolve each rendered identity's outermost group
ancestor. Two rendered elements with the same non-null effective group are not
collision candidates. Different groups, two ungrouped elements, or one grouped
plus one ungrouped element remain candidates. A group identity itself is never a
collision candidate. Grouping suppresses noise only; it does not hide a real
overlap across group boundaries.

### Image assets

Web, Cloud and Desktop admit the same image profile. Raster assets may be PNG,
JPEG, GIF or WebP and contain at most 50,000,000 bytes. SVG assets contain at most
5,000,000 bytes and must belong to DEKS's static safe subset. Every image is at
most 16,384 units on either side and its logical width × height is at most
40,000,000 pixels.

SVG admission parses and emits canonical UTF-8 XML. It permits geometry, groups,
gradients and clipping, but rejects executable or ambient content: scripts, event
attributes, CSS/style, fonts and `<text>`, `foreignObject`, nested `<image>`,
`<use>`, SMIL animation, declarations/entities/processing instructions, extra
namespaces, and remote or data references. `<title>` and `<desc>` remain available
as inert metadata. The safe subset is bounded to 10,000 nodes, depth 64, 100,000
attributes and 2,000,000 path-data characters. Never treat arbitrary SVG markup
as an already-safe asset.

Bytes enter a host only through its asset admission path: `add_asset` on Desktop,
or the Web/Cloud upload flow. That path inspects the real bytes, canonicalizes SVG,
computes the content hash and declares the descriptor. `define-asset` is not an
upload bypass; use it only when those exact admitted bytes already exist in the
host.

A portable `.deks` is a ZIP package with a strict manifest and every declared
asset embedded by content hash. Host locks, paths, URLs, idempotency receipts and
workspace bookkeeping never enter the package. Import rechecks media bytes,
dimensions, hashes and canonical SVG rather than trusting an extension or declared
media type. Web PPTX export keeps admitted SVG as vector artwork and includes a
PNG compatibility fallback for PowerPoint consumers that cannot render SVG.

### Narration audio assets

Codec v3 admits `audio/wav` canonical RIFF/WAVE integer PCM (16 or 24 bit) and
frame-only `audio/mpeg` MPEG-1 Layer III. Audio is at most 50,000,000 bytes and
10 minutes, has one or two channels and a sample rate from 8,000 to 48,000 Hz.
Admission sniffs and parses the bytes; extensions and declared MIME are not
evidence. WAV uses one `fmt ` chunk followed by `data`; portable MP3 has no ID3
metadata or trailing bytes. The normal recording profile is mono, 24 kHz,
16-bit WAV so Web and Desktop do not persist a browser-specific capture codec.

Narration audio is always `kind: "embedded"` and travels in the `.deks` by
content hash. A remote URL is not portable narration. The file contains the
selected rendition and whether it is `human-recorded` or `synthetic`; provider,
model, voice ID, generation job, credits, consent and revocation remain in the
host that produced it.

## Slide

`id`, `name`, `isTemplate`, `background`, optional `motion`, optional
`narration`, and `states`.

`narration`, when present, is exactly:

```json
{
  "script": "Texto que se dirá en esta slide.",
  "pauseBeforeMs": 250,
  "pauseAfterMs": 600,
  "audio": {"assetId": "voice-intro", "provenance": "human-recorded"}
}
```

`script` is non-empty plain text. Both pauses are integer milliseconds from
0 through 60,000. `audio` is optional while a script is being drafted; when
present it references an admitted embedded WAV/MP3 asset and provenance is
`human-recorded` or `synthetic`. Playback is a host concern, not renderer state.

`background` is `{"kind":"solid","color":"#RRGGBB"}` or
`{"kind":"linear-gradient","startColor":"#…","endColor":"#…","angleDeg":n}`.
A shape's `shapeFill` takes the same two shapes.

## Element state

Every state carries `elementId`, `x`, `y`, `width`, `height`, `rotationDeg`,
`opacity`, `zIndex`, an optional normalized `anchor`, an optional `motion` patch,
and the continuous fields its kind requires. Fixed text fields never belong here.

`anchor`, when present, is exactly `{"x": n, "y": n}` with both coordinates in
`0..1`: `{0,0}` is top-left, `{0.5,0.5}` is the centre and `{1,1}` is bottom-right.
The state's `x` and `y` identify that pivot, and rotation happens around it. To
recover the unrotated top-left use `left = x - anchor.x * width` and
`top = y - anchor.y * height`. Omitting `anchor` is deliberately equivalent to
`{0,0}`, so every existing document keeps its legacy top-left geometry and omits
the field on serialization.

| Kind | Required on every state |
|---|---|
| `text` | `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `fill`; optional animatable `padding` |
| `shape` | `shapeFill`, `stroke`, `strokeWidth` (identity carries `shapeKind`: `rectangle`, `ellipse`, `line` or `diamond`) |
| `image` | `assetId`, `alt`, `fit` |
| `link-button` | `label`, `url` (absolute HTTPS), `fill`, `textColor`, `fontFamily`, `fontSize`, `fontWeight`, `cornerRadius`, `stroke`, `strokeWidth` |
| `icon` | `iconFamily`, `iconName`, `fill`, `strokeWidth` |
| `number` | `value`, `decimals`, `groupSeparator`, `decimalSeparator`, `symbol`, `symbolPosition`, plus the whole text typography set |
| `group` | logical identity only; it normally has no state and never transforms descendants |

A `line` uses `stroke` with a solid transparent `shapeFill`, never a gradient.

### Text identity and padding

`content`, `fontFamily`, `horizontalAlignment`, `verticalAlignment` and
`overflowMode` belong to the text identity and therefore apply to every slide
where that identity appears. They are not accepted in a slide state. Updating one
of them edits the element globally; both sides of a boundary still resolve the
same value, so a continuing text can keep its one-node morph.

Use a different identity for a different phrase, claim, label or semantic text
type. A heading must not reuse a caption identity merely because their boxes
overlap. Keep alignment stable too: for fine visual adjustment, change state `x`
and `y` (or width/padding), not `horizontalAlignment` or `verticalAlignment`.

Text `padding`, when present on a state, is exactly
`{"top":n,"right":n,"bottom":n,"left":n}`. All four non-negative canvas-unit
values are required together. Omission is equivalent to four zeros. Each side is
continuous and interpolates between checkpoints; it changes only the inner text
box, never the outer AABB, anchor, selection rectangle or snapping geometry.

### The number element

A `number` carries a magnitude, not a string of digits, so it has no `content`.
Its formatting is declared, never resolved from a locale: `decimals` (0–6),
`groupSeparator` (`""`, `","`, `"."`, `" "`, `"'"`), `decimalSeparator` (`"."` or
`","`), `symbol` (up to 8 characters) and `symbolPosition` (`before`/`after`). The
same file therefore renders the same digits on every machine.

Its identity carries `animateMagnitude`, three booleans naming which roles count
towards the value: entering counts up from zero, leaving counts down to zero, and a
morph counts between the two checkpoints' values, each on that role's own duration
and easing. A cut, a zero duration, and reduced motion all land on the final value
immediately.

### The icon element

An icon needs a catalog-backed `iconFamily` and `iconName`; the glyph takes the
element's own colour. The `lucide` family is the complete official Lucide 1.34.0
set, pinned and bundled offline as sanitized primitive nodes. Cloud can search and
page that catalog; Desktop validates and renders the same names but does not expose
a catalog-search tool. Never paste arbitrary SVG and never fetch an icon URL at
render time. Treat an icon identity change as discrete between checkpoints;
position, scale, rotation, opacity and colour still animate through the stable
identity.

## What makes a change continuous or discrete

At a boundary the renderer resolves each shared identity. It interpolates a single
node — a true morph — only when nothing about the element changed discretely. It
cross-fades two nodes when something did.

A valid v2 text identity cannot have different `content`, `fontFamily`,
`horizontalAlignment`, `verticalAlignment` or `overflowMode` on opposite sides of
a boundary: those fields are declared once on the identity. Replacement text uses
a different identity and therefore plays `out` then `in`. For an image a discrete
change is a different asset, `fit` or `alt`; for a shape a different `shapeKind` or
fill kind; for a link-button a different `label`, `url` or `fontFamily`; for an
icon a different family, name or stroke width; for a number any formatting
difference, or a value change when that role does not count.

Everything else interpolates: `x`, `y`, `width`, `height`, `rotationDeg`, `opacity`,
`fill`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, each text padding
side, shape fill colour, border colour and width, and corner radius.

This is the lever behind the strongest choreography in DEKS. A line of text whose
identity continues while its box, size, colour, padding and position change is one
node that travels and grows — which is how a list item becomes the next slide's
title. A different string is a different identity. See `$deks-motion-patterns`.

Do not use that discrete cross-fade as a shortcut for replacement copy. Text
identity follows content, not the rectangle that happens to contain it:

| Boundary | Identity decision |
|---|---|
| `Revenue` moves and grows into the next title as `Revenue` | Keep one identity. |
| `Revenue` is replaced by the new claim `Growth` in the same box | Give each string its own identity. |

In the second case, the `Revenue` state exists only before the boundary and plays
`out`; the `Growth` state exists only after it and plays `in`. Sequence those roles
so the first text is fully gone before the second starts. A shared semantic role,
style or geometry never overrides this rule.

## Universal interoperability limits

These bound the portable file itself, not any plan:

`slides` 200 · `elements` 100 000 · `states per slide` 500 · `assets` 10 000 ·
document JSON 5 MB · text 100 000 characters · canvas 320×180 to 16 384 with an
aspect ratio at most 4:1 · geometry ±100 000 · size 0.1 to 100 000 · font size 0.1
to 10 000 · font weight 1 to 1 000 · line height 0.1 to 100 · rotation ±36 000 ·
z-index ±100 000 · `motionBeatMs` 50 to 60 000 · `durationBeats` 0 to 8 ·
`delayBeats` 0 to 16 · `delayMs` 0 to 60 000 · scale factor 0.01 to 10 ·
bezier x within 0..1, y within ±100.

A host may enforce tighter product quotas on top of these; those live in the host's
own skill. The portable package itself is limited to 95,000,000 physical bytes and
90,000,000 total uncompressed bytes. Those are interoperability/security bounds,
not Cloud storage-plan quotas or an MCP response limit.
