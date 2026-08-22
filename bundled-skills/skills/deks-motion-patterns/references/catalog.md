# The pattern catalogue

Examples use the DEKS Core envelope (kebab-case `type`, camelCase payload). On Cloud,
translate to `{"command": …, "arguments": {…}}` in snake_case — see
`$deks-desktop-mcp` → `references/commands.md`.

Geometry below assumes a 1600×900 canvas and `motionBeatMs: 600`.

---

## Promotion to title

**The move.** A set of lines is on screen. On the next checkpoint they leave in
sequence and one of them stays, grows, travels to the heading position and takes over
the slide. The audience watches an idea get selected out of a list.

**Why it works.** The surviving line is *the same element*, with *the same string*.
Nothing about it changes discretely, so the renderer keeps one node and interpolates
its position, size, colour, weight and letter spacing. That single node travelling is
the entire effect; two elements cross-fading would look like an ordinary slide change.

**Build it.**

1. On the opening checkpoint, give the future title a state that looks like the other
   list items: same font family, same alignment, same overflow mode, list-sized.
2. Give the siblings their own identities. They exist only here.
3. On the next checkpoint, give the same title identity its heading state. Change
   only geometry and style — never `content`, `fontFamily`, `horizontalAlignment`,
   `verticalAlignment` or `overflowMode`.
4. Put the timing patch on the **arriving** slide: a `morph` is resolved from the
   slide the element arrives at.
5. Let the box width and font size do the line breaking. A string that sits on one
   line at 34 px will wrap to two at 64 px in the same box — so the fragment becomes a
   two-line headline without you touching the text.

```json
{"type": "add-element-state", "slideId": "apertura", "state": {
  "elementId": "story-title", "x": 80, "y": 638, "width": 920, "height": 58,
  "rotationDeg": 0, "opacity": 1, "zIndex": 4,
  "content": "Una idea no debería romperse en el camino.",
  "fontFamily": "Poppins", "fontSize": 34, "fontWeight": 600,
  "lineHeight": 1.25, "letterSpacing": 0,
  "horizontalAlignment": "left", "verticalAlignment": "middle",
  "overflowMode": "hidden", "fill": "#F2F1EC"
}}
```

```json
{"type": "add-element-state", "slideId": "contexto", "state": {
  "elementId": "story-title", "x": 80, "y": 188, "width": 920, "height": 224,
  "rotationDeg": 0, "opacity": 1, "zIndex": 4,
  "content": "Una idea no debería romperse en el camino.",
  "fontFamily": "Poppins", "fontSize": 64, "fontWeight": 600,
  "lineHeight": 1.05, "letterSpacing": -1.4,
  "horizontalAlignment": "left", "verticalAlignment": "middle",
  "overflowMode": "hidden", "fill": "#F2F1EC"
}}
```

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "contexto", "elementId": "story-title"},
 "role": "morph",
 "patch": {"durationBeats": 1.5, "delayBeats": 0.35, "easing": [0.22, 1, 0.36, 1]}}
```

The small `delayBeats` matters: the siblings start leaving first, so the promotion
reads as a consequence rather than a coincidence.

**Do not use it** when the promoted line has to say something different as a title.
The moment the string changes you get a cross-fade, and the whole effect is gone —
better then to write the title as its own element and use **replacement**.

---

## Staggered exit and staggered entry

**The move.** Siblings leave or arrive in visual bands, so the eye reads an order
without falsely sequencing elements that share one row.

**Why it works.** `delayBeats` is musical: `0.12` is 12% of a beat, and a rising
series of them is a staircase that survives a change of tempo. In milliseconds the
same chain falls out of step the day someone edits `motionBeatMs`.

First group the elements by their full vertical bounds and text baselines. Elements
on the same row or baseline share a delay; increase it only for the next visual band
in the reading direction. Do not sort by `y` alone: boxes of different heights may
belong to the same band even when their top edges differ.

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "apertura", "elementId": "story-station-2"},
 "role": "out",
 "patch": {"animation": {"kind": "slide", "edge": "left", "distance": 64},
           "durationBeats": 0.6, "delayBeats": 0.12, "easing": "ease-in"}}
```

For five successive bands, repeat with `delayBeats` `0`, `0.12`, `0.24`, `0.36`,
`0.48`. If two elements occupy one band, give both the same value. Keep the step
small: above roughly `0.2` per band the group stops reading as one gesture and starts
reading as separate events.

**Do not use it** on more than about six items, and never on something the audience
must read as simultaneous — a set of totals that arrive one by one implies a sequence
the data does not have.

---

## Text relay

**The move.** One line is replaced by another in the same position.

**Why it works — and why fade does not.** Two cross-dissolving strings overlap:
descenders of the outgoing line cut through the caps of the incoming one and for a
third of a second the audience reads neither. `crop` fixes it completely — the
outgoing line leaves behind its own boundary and the incoming one arrives behind the
same boundary, so two texts are never legible in the same place at once.

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "b", "elementId": "claim-new"},
 "role": "in", "patch": {"animation": {"kind": "crop", "edge": "bottom"}, "durationBeats": 0.7, "delayBeats": 0.7}}
{"type": "set-motion", "scope": {"kind": "element", "slideId": "a", "elementId": "claim-old"},
 "role": "out", "patch": {"animation": {"kind": "crop", "edge": "top"}, "durationBeats": 0.7}}
```

An honest `{"kind":"none"}` cut is also better than a fade here. Abrupt is a choice
the audience can follow; mush is not.

The `0.7`-beat delay is not decorative: it equals the outgoing duration, so the old
line is fully outside the zone before the new one starts. If the outgoing motion has
its own delay, add it too; the invariant is `incoming delay >= outgoing delay +
outgoing duration`.

**Do not use it** when nothing replaces the outgoing text. A paragraph that is simply
done can fade out — there is nothing behind it for the dissolve to muddy.

---

## Progress bar

**The move.** A bar fills across checkpoints, so the deck's own position in the
argument is visible.

**Build it** as two shapes with stable identities: a track that never changes and a
fill whose `width` differs per checkpoint. The fill morphs, because width interpolates.

```json
{"type": "update-element-state", "slideId": "capitulo-3", "elementId": "progress-fill", "patch": {"width": 198}}
{"type": "set-motion", "scope": {"kind": "element", "slideId": "capitulo-3", "elementId": "progress-fill"},
 "role": "morph", "patch": {"durationBeats": 1.2, "delayBeats": 0.2, "easing": "ease-in-out"}}
```

On the first appearance, reveal the track with a `wipe` (it was always going to be
there) and the fill with a `crop` from the same edge (it is filling):

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "capitulo-1", "elementId": "progress-track"},
 "role": "in", "patch": {"animation": {"kind": "wipe", "edge": "left"}, "durationBeats": 0.7, "delayBeats": 1.4}}
{"type": "set-motion", "scope": {"kind": "element", "slideId": "capitulo-1", "elementId": "progress-fill"},
 "role": "in", "patch": {"animation": {"kind": "crop", "edge": "left"}, "durationBeats": 0.9, "delayBeats": 1.7}}
```

**Do not use it** on a deck of three slides, and never let the fill colour change
fill *kind* between checkpoints — solid to gradient is a discrete change and the bar
will cross-fade instead of growing.

---

## Counting figure

**The move.** A magnitude counts up instead of appearing.

```json
{"type": "define-element", "element": {"id": "kpi-growth", "kind": "number", "name": "Crecimiento",
  "isLocked": false, "animateMagnitude": {"in": true, "morph": true, "out": false}}}
```

Entering counts from zero, a morph counts between the two checkpoints' values, and
each follows that role's own duration and easing — digits and movement on the same
curve by construction.

Count when the magnitude *is* the argument: a result, a growth, a total the audience
should feel the size of. **Do not count** a year, a version, a reference number or an
axis label — watching an identifier spin reads as a bug. A figure that should not
count still must not cross-fade between two values: give it a `crop`.

Keep the box wide enough for the final value. The renderer uses tabular figures so
digits do not wobble, but it cannot invent room the composition never gave.

---

## Accumulation

**The move.** Each checkpoint adds one element and moves nothing already on screen.
The picture builds; nothing is taken away.

**Build it** by giving every prior element an identical state on the new checkpoint —
same geometry, same everything — so they morph to themselves and stay perfectly
still, and letting only the new element declare an `in`.

This is the pattern for a diagram assembled step by step, a list that grows, a stack
of evidence. Its whole power is that the old material does not twitch: resist the
urge to "rebalance" the composition on each step, because a 12-pixel nudge is visible
motion and the audience will read it as meaning something.

**Do not use it** past five or six additions. After that the slide is a wall and the
argument needs a section break, not another item.

---

## Replacement

**The move.** The old thing leaves and the new one takes its exact place, because it
supersedes it.

Two different identities occupying the same rectangle, the outgoing one with an `out`
and the incoming one with an `in` delayed behind it:

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "a", "elementId": "plan-old"},
 "role": "out", "patch": {"animation": {"kind": "crop", "edge": "top"}, "durationBeats": 0.7, "easing": "ease-in"}}
{"type": "set-motion", "scope": {"kind": "element", "slideId": "b", "elementId": "plan-new"},
 "role": "in", "patch": {"animation": {"kind": "crop", "edge": "bottom"}, "durationBeats": 0.7, "delayBeats": 0.7}}
```

The delay is the meaning: without it the two overlap and the substitution reads as an
accident. **Do not use it** for two things that coexist in the argument — that is
accumulation.

---

## Travelling protagonist

**The move.** One persistent object moves along a route across several checkpoints
while everything else stays exactly where it was.

**Build it** by writing a section contract first: which identities persist, at what
anchor, and which single object is allowed to move. Then, at each edge, only the
protagonist's `x`/`y` differ.

The discipline is the pattern. If three things move, nothing moved — the audience has
no protagonist to follow. Everything not travelling keeps identical geometry so it
morphs to itself and stays still.

**Do not use it** when the movement has no referent. An object that wanders because
each slide was composed independently is the single most common defect in an animated
deck, and it is indistinguishable from a bug.

---

## Curtain reveal (wipe) and edge reveal (crop)

Both keep the element in place and neither touches opacity. They differ in what moves.

- **`wipe`** — the element is stationary and the mask edge travels across it. It reads
  as *uncovering something already there*: a chart drawn left to right, a rule that
  draws itself, a list uncovered downwards.
- **`crop`** — the mask is stationary and the content travels inside it. It reads as
  *something arriving from behind a boundary*: a new line, a figure climbing into view.

```json
{"type": "set-motion", "scope": {"kind": "element", "slideId": "b", "elementId": "rule"},
 "role": "in", "patch": {"animation": {"kind": "wipe", "edge": "top"}, "durationBeats": 0.8, "easing": "ease-out"}}
```

Neither takes a `distance`: the travel is exactly the element's own extent, so the
effect is the same at any size. Pick the `edge` for meaning — a figure that climbs
reads better cropping up from `bottom`; a list item arriving under the one above it
comes from `top`.

**Do not** reach for either on something that genuinely enters the scene from
elsewhere. That is a `slide` with a distance.

---

## Narrative zoom

**The move.** The frame goes from the whole picture to one detail without cutting to
a new scene.

**Build it** by keeping the detail's identity present in both checkpoints and letting
its `x`, `y`, `width` and `height` interpolate from small-and-in-place to
large-and-centred, while the surrounding material either leaves or drops in opacity.
The background must not change: a new background says "new scene" and destroys the
sense that you moved closer to the same thing.

**Do not use it** with `{"kind":"scale","from":0.2}` on the entering element instead —
that is a different effect. A scale-in is an object landing; a zoom is the *frame*
moving, and only interpolated geometry on a persistent identity reads that way.

---

## Focus by dimming

**The move.** What is no longer the point drops to a low opacity and stays visible.

```json
{"type": "update-element-state", "slideId": "detalle", "elementId": "context-block", "patch": {"opacity": 0.25}}
```

`opacity` interpolates, so this needs no motion patch at all — the deck's inherited
morph does it. Use it when the context must remain readable as context: an item
selected out of a list that stays on screen, one column of a table under discussion.

**Do not use it** as a substitute for removing material. Six dimmed blocks are still
six blocks of visual weight.

---

## Before and after

**The move.** The same object in two states, compared.

Keep one identity across the boundary and change what the comparison is about —
colour for status, width for magnitude, position for place. Change **one** dimension.
Two dimensions changing at once is not a comparison, it is a redraw, and the audience
cannot tell which one carried the meaning.

Reserve green, red and yellow for success, failure and attention. A block that morphs
from `#A8ADB5` to `#65C18C` says "this resolved" without a word of narration.

---

## Section protagonist

**The move.** One icon or object persists through an entire section and changes state
at each checkpoint, carrying the thread while the copy around it turns over.

**Build it** as a single identity with a fixed anchor for the whole section. Each
checkpoint changes only its state — colour, scale, rotation, or, for an icon, its
glyph. An icon identity change is discrete, so the glyph swap cross-fades in place
while position and colour still interpolate through the stable identity; that mixed
behaviour is correct and reads well as long as the anchor does not move.

Re-anchor it only at a real section boundary, and when you do, make that the edge's
one central motion.

**Do not** give each checkpoint its own copy of the object. Five near-identical icons
under five IDs is five cross-fades, and the thread the pattern exists to create never
forms.
