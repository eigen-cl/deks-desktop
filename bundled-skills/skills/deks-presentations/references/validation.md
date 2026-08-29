# Document invariants and bounds

Every host validates the whole document before and after a write. A batch that would leave the
document invalid is rejected atomically and the revision does not advance. Understanding these
rules turns a class of failed writes into edits you never send.

## Structural invariants

- `format` is exactly `"deks"` and canonical portable documents require
  `codecVersion: 3`; every root key must be present and no unknown key is allowed.
  An absent version or `codecVersion: 1` migrates v1 → v2 → v3; explicit v2
  migrates v2 → v3; future versions are rejected. The v1 → v2 step uses the first state in
  slide order for fixed text identity fields and may return non-blocking conflict
  warnings.
- `revision` is a non-negative integer maintained by the host.
- Every object rejects unknown properties. An element state rejects identity fields
  (`id`, `kind`, `name`, `shapeKind`, `semanticRole`, `parentId`, `isLocked`) outright.
  A text state also rejects `content`, `fontFamily`, `horizontalAlignment`,
  `verticalAlignment` and `overflowMode`: v2 requires them once on its text identity.
- IDs match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Element and asset IDs allow up to 256 code points,
  the document ID up to 128.
- Text rejects control characters and unpaired Unicode surrogates.
- Element IDs are unique; slide IDs are unique; an element appears at most once in one slide's
  `states`.
- Every `states[].elementId` must reference a declared element.
- Every image state's `assetId` must reference a declared asset. An asset still referenced by
  any state or slide narration cannot be removed.
- An admitted image must be PNG, JPEG, GIF or WebP up to 50 MB, or canonical
  static SVG up to 5 MB. Its real bytes, dimensions and content hash must match
  the descriptor; neither a filename nor a declared media type is evidence.
- Every image is at most 16,384 units on either side and its logical width ×
  height is at most 40 megapixels.
- SVG rejects scripts, event handlers, CSS/style, fonts, `<text>`,
  `foreignObject`, nested `<image>`, `<use>`, SMIL animation, declarations,
  entities, processing instructions, extra namespaces, and remote/data
  references. Only `<title>` and `<desc>` may contain inert text. SVG complexity
  is bounded to 10,000 nodes, depth 64, 100,000 attributes and 2,000,000
  path-data characters.
- Slide `narration`, when present, has exactly non-empty plain `script`, integer
  `pauseBeforeMs`, integer `pauseAfterMs`, and optional `audio`. Audio contains
  exactly `assetId` plus provenance `human-recorded | synthetic`, and references
  a declared embedded `audio/wav` or `audio/mpeg` asset.
- Narration audio is at most 50 MB and 10 minutes, has 1–2 channels and a sample
  rate of 8–48 kHz. WAV is canonical integer PCM at 16 or 24 bit; MP3 is
  frame-only MPEG-1 Layer III without metadata or trailing bytes.
- `parentId` must reference a declared named `group`, and the parent chain must not contain a cycle.
- Group identities are logical folders: they need no state and never transform descendants;
  every member keeps its own absolute canvas geometry, style, z-order and motion.
  Collision scans skip group identities and skip a rendered pair only when both
  resolve to the same non-null outermost group; every other pair remains a candidate.
- An element with children cannot be deleted.
- A presentation always has at least one slide; the last remaining slide cannot be deleted.
- Reordering slides requires the complete list, every existing slide exactly once.
- `animateMagnitude` is required on a `number` identity — all three roles, always — and
  invalid on every other kind. `shapeKind` is required on a `shape` and invalid elsewhere.
- `shapeKind` is one of `rectangle`, `ellipse`, `line` or `diamond`.
- `anchor` is optional. When present it contains exactly both `x` and `y`, each in
  `0..1`; a partial anchor is invalid. Omission preserves the legacy top-left pivot.
- Text `padding` is optional and state-owned. When present it contains exactly
  `top`, `right`, `bottom` and `left`, all four required and non-negative. Omission
  means four zeros. It is invalid on non-text states.
- `groupSeparator` must differ from `decimalSeparator` unless it is empty.
- A `line` shape must use a solid `shapeFill`. `cornerRadii` is valid only on a `rectangle`.
- A `link-button` `url` and a remote asset `url` must be absolute, credential-free HTTPS.
- The document `motion` declares all three roles completely. A slide or state `motion` patch
  must change at least one role and each declared role at least one property.

## Numeric bounds

Portable document bounds, enforced by every host:

| Field | Bound |
|---|---|
| `canvas.width` | integer 320 – 16384 |
| `canvas.height` | integer 180 – 16384 |
| canvas aspect ratio | between 1:4 and 4:1 |
| `x`, `y` | ±100 000 |
| `anchor.x`, `anchor.y` | 0 – 1 when `anchor` is present; both required together |
| `width`, `height` | 0.1 – 100 000 |
| `rotationDeg` | ±36 000 |
| `opacity` | 0 – 1 |
| `zIndex` | integer, ±100 000 |
| `fontSize` | 0.1 – 10 000 |
| `fontWeight` | integer 1 – 1000 |
| `lineHeight` | 0.1 – 100 |
| `letterSpacing` | ±1000 |
| `padding.top`, `.right`, `.bottom`, `.left` | 0 – 100 000 when `padding` is present; all four required |
| `strokeWidth` | 0 – 1000 (an `icon` narrows this to 0.5 – 8) |
| `cornerRadius`, each of `cornerRadii` | 0 – 100 000 |
| `motionBeatMs` | integer 50 – 60 000 |
| `durationBeats` | 0 – 8 |
| `delayBeats` | 0 – 16 |
| `delayMs` | integer 0 – 60 000 |
| `narration.pauseBeforeMs`, `.pauseAfterMs` | integer 0 – 60 000 |
| `slide` `distance` | ≥ 0.1 |
| `scale` `from` | 0.01 – 10 |
| bezier `easing` | x in 0 – 1, y within ±100 |
| `value` on a `number` | ±1 000 000 000 000 |
| `decimals` | integer 0 – 6 |
| `symbol` | up to 8 characters |
| gradient `angleDeg` | ±3600 |
| `name` | up to 200 code points |
| `semanticRole` | up to 100 code points |
| `alt` | up to 2000 code points |
| `label` | up to 200 code points |
| `iconName` | up to 100 code points |
| `url` | up to 2048 code points |

Portable capacity bounds: at most 200 slides, 500 states per slide, 100 000 elements, 10 000
assets, 100 000 characters of `content`, and 5 MB of document JSON. Each
narration script is at most 100,000 characters.

A portable `.deks` embeds all declared assets and is limited to 95 MB as a
physical archive and 90 MB total after decompression. Import rejects missing,
extra, duplicated or non-canonical asset entries as well as hash, byte-size or
media-type mismatches.

**A host may enforce tighter bounds than the portable format.** DEKS Cloud does — see
`$deks-cloud-mcp` for its own slide, state, element, asset, text and byte limits and the
`resource_limit_reached` code. Never delete existing content to fit inside a limit; report it.

## Geometry is authored, not measured

Nothing in the document knows how text will actually wrap. Keeping content inside the canvas,
avoiding harmful wrapping, and avoiding accidental overlap are authoring responsibilities that
only a real render can confirm.

Host-side geometry validation, where it exists, compares authored rectangles and conservative
text estimates. It cannot establish typography, contrast, crop quality or motion. A clean
geometry result is not a visual approval. Render the checkpoint and look at it.

## Safe writing

- Send the exact latest revision on every revision-aware write.
- One semantic idempotency key per intended transaction; reuse it only to retry that exact
  request. Both hosts reject a reused key whose payload differs.
- Keep a batch at or below 100 commands; a failed batch rolls back completely.
- A timeout or transport error is an uncertain result, not a failure. Read
  [recovery.md](recovery.md) before touching the deck again.
- Never delete and never publish without an explicit user request for that change.
