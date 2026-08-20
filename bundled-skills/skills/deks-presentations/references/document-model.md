# The DEKS document model

Field names are given in the canonical document's camelCase. The Cloud MCP takes
the same fields in snake_case; the Desktop MCP takes them exactly as written here.
`$deks-cloud-mcp` and `$deks-desktop-mcp` give the exact spelling per host.

## Document

| Field | Meaning |
|---|---|
| `format` | Always `"deks"`. |
| `id`, `name`, `revision` | Identity and the monotonic revision every write declares. |
| `canvas` | `{width, height}` in canvas units. Every geometry below is in those units, not pixels. |
| `motionBeatMs` | The deck's tempo. Every duration and musical delay is a multiple of it. |
| `motion` | The complete three-role declaration everything else inherits from. |
| `palette` | Six semantic roles: `primary`, `secondary`, `accent`, `background`, `text`, `subtext`. |
| `assets` | Declared asset descriptors. An image state references one by `assetId`. |
| `elements` | The identities: `id`, `kind`, `name`, `isLocked`, and for a shape its `shapeKind`, for a number its `animateMagnitude`. |
| `slides` | The ordered checkpoints. |

There is no transitions array. A boundary is simply two adjacent slides, and each
element's role at that boundary follows from which of the two it has a state on.

## Slide

`id`, `name`, `isTemplate`, `background`, an optional `motion` patch, and `states`.

`background` is `{"kind":"solid","color":"#RRGGBB"}` or
`{"kind":"linear-gradient","startColor":"#…","endColor":"#…","angleDeg":n}`.
A shape's `shapeFill` takes the same two shapes.

## Element state

Every state carries `elementId`, `x`, `y`, `width`, `height`, `rotationDeg`,
`opacity`, `zIndex`, an optional `motion` patch, and the fields its kind requires:

| Kind | Required on every state |
|---|---|
| `text` | `content`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `horizontalAlignment`, `verticalAlignment`, `overflowMode`, `fill` |
| `shape` | `shapeFill`, `stroke`, `strokeWidth` (identity carries `shapeKind`: `rectangle`, `ellipse` or `line`) |
| `image` | `assetId`, `alt`, `fit` |
| `link-button` | `label`, `url` (absolute HTTPS), `fill`, `textColor`, `fontFamily`, `fontSize`, `fontWeight`, `cornerRadius`, `stroke`, `strokeWidth` |
| `icon` | `iconFamily`, `iconName`, `fill`, `strokeWidth` |
| `number` | `value`, `decimals`, `groupSeparator`, `decimalSeparator`, `symbol`, `symbolPosition`, plus the whole text typography set |
| `group` | nothing beyond the common geometry |

A `line` uses `stroke` with a solid transparent `shapeFill`, never a gradient.

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
element's own colour. Query the catalog by meaning. Never paste arbitrary SVG and
never fetch an icon URL at render time. Treat an icon identity change as discrete
between checkpoints; position, scale, rotation, opacity and colour still animate
through the stable identity.

## What makes a change continuous or discrete

At a boundary the renderer resolves each shared identity. It interpolates a single
node — a true morph — only when nothing about the element changed discretely. It
cross-fades two nodes when something did.

A **discrete change** in text is a different `content`, `fontFamily`,
`horizontalAlignment`, `verticalAlignment` or `overflowMode`. For an image it is a
different asset, `fit` or `alt`; for a shape a different `shapeKind` or fill kind;
for a link-button a different `label`, `url` or `fontFamily`; for an icon a
different family, name or stroke width; for a number any formatting difference, or a
value change when that role does not count.

Everything else interpolates: `x`, `y`, `width`, `height`, `rotationDeg`, `opacity`,
`fill`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`, shape fill colour,
border colour and width, and corner radius.

This is the lever behind the strongest choreography in DEKS. A line of text that
keeps exactly the same string and typography while its box, size, colour and
position change is one node that travels and grows — which is how a list item
becomes the next slide's title. Change the string too, and the same authoring
degrades silently into a cross-fade. See `$deks-motion-patterns`.

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
own skill.
