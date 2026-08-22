# Motion as narrative

For ready-made choreographies built on this contract, read `$deks-motion-patterns`.

## The model in one paragraph

Every element plays exactly one of three roles at a boundary: `in` when it is only
on the second slide, `out` when it is only on the first, and `morph` when it is on
both. Each role carries an `animation`, a `duration_beats`, two delays that add —
`delay_beats` and `delay_ms` — and an `easing`. The presentation declares all three roles in full; a slide and an element
state declare only what they change, property by property. Write the exception where
it belongs and let everything else inherit.

## Establish the base rhythm

Set one `motion_beat_ms` for the presentation and express every duration as a
multiple of it:

- `1` beat: normal checkpoint work;
- `0.5` or `0.75`: supporting changes and quick acknowledgements;
- `1.5` or `2`: deliberately weighty transformations.

Avoid arbitrary milliseconds. Delay has two units and they add: `delay_beats` is
musical, so `1` waits exactly as long as a one-beat animation lasts and "start
when that one ends" survives a change of tempo; `delay_ms` is absolute, for an
offset that is about a specific instant rather than about the rhythm. Reach for
beats first — a chain written in milliseconds falls silently out of step the day
someone edits `motion_beat_ms`. Use either sparingly: a delay on one element lets
it land after the one it depends on, not to build an implicit choreography of
many.

When an entrance or exit should read as a stagger, group elements into **visual
bands** before assigning delays. Compare their full vertical bounds, visual centres,
and text baselines rather than sorting by `y` alone: elements on the same row or
baseline should normally share a start time. Increase the delay between bands in the
reading direction. Within one band, add another step only when the content itself is
sequential; otherwise different delays invent an order the composition does not have.

## Let the presentation carry the flow

Set the presentation-level motion first, with `set_motion` and no `slide_id`. That
declaration must be complete; it is the only one that is. Most elements should never
need anything else.

Text may enter, exit or remain. When the argument implies no direction or boundary,
`fade` or `none` remains the quiet default. Use a short `slide` only for meaningful
lateral arrival or departure, and `crop` when the content should travel inside its
fixed mask. Do not make text travel merely because the composition changes between
checkpoints.

Before authoring motion, write a section contract with:

- the identities that persist through the section;
- their anchored position and scale;
- the local elements that may enter or exit;
- the section-boundary transformation that can justify re-anchoring.

Do not animate responsive re-layout. If a continuing object moves a few pixels only
to balance the next static composition, keep it on its section anchor and arrange
the local content around it.

For every edge, name one central motion in a short causal phrase such as `the route
branches`, `the barrier blocks the approved path`, or `the pilot perimeter encloses
the route`. By default animate only one or two focal story elements. A tightly
coupled group may move together when it reads as that same action; unrelated
interpolation is jitter and must be removed.

## The animations, and what each one is for

| Animation | Shape | Use it when |
|---|---|---|
| `{kind: "fade"}` | opacity only | an idea is restated, revealed, or changes emphasis without implied movement |
| `{kind: "slide", edge, distance?}` | travels from or towards an edge | an object is displaced, transferred, or arrives from a meaningful direction |
| `{kind: "crop", edge}` | revealed inside its own box, which masks it | text and figures, especially when one replaces another in the same position |
| `{kind: "wipe", edge}` | uncovered in place; only the mask edge moves | something that should feel already present and merely revealed — a chart drawn left to right, a list uncovered downwards |
| `{kind: "scale", from}` | starts smaller or larger, in place | something is presented, magnified or lands as an object rather than as text |
| `{kind: "none"}` | instantaneous | the change is meant to be a cut |
| `{kind: "morph"}` (role `morph`) | interpolates both states | the element continues and its geometry or style carries the change |
| `{kind: "cut"}` (role `morph`) | snaps between states | a continuing element must not draw attention while something else moves |

Three parameters are worth knowing:

- **`distance`** on a slide. Without it the element travels until it is completely
  off the canvas, which is the right default for something that leaves the story.
  With it the element travels exactly that many canvas units: a short 40 to 120 unit
  slide reads as a nudge, an arrival in place, not an entrance from outside.
- **`from`** on a scale. `0.8` to `0.95` reads as the object settling; below `0.5`
  it reads as a zoom and competes with the content.
- **Neither `crop` nor `wipe` takes a distance.** The content always travels its own box, so the effect
  is the same whatever the element's size. Pick the `edge` for meaning: a figure that
  climbs reads better cropping up from `bottom`, a list item arriving under the one
  above it from `top`.

`easing` accepts the four named curves or four cubic-bezier controls
`[x1, y1, x2, y2]`. Prefer `ease-out` for entrances, `ease-in` for exits and
`ease-in-out` for morphs; reach for a bezier only when a specific overshoot or
deceleration is part of the story.

## Crop or wipe?

Both avoid the fade and both keep the element in place; they differ in what
moves. A `crop` moves the content inside a fixed mask, so the element reads as
arriving from behind a boundary — right when something new appears. A `wipe`
moves the boundary over a fixed element, so it reads as uncovering something
already there — right for a chart drawn left to right, a list uncovered
downwards, a figure that should not appear to fly in.

When one text replaces another in the same position, reach for `crop`: the
outgoing line leaves behind the boundary the incoming one arrives behind.

The rectangle is an exclusive temporal zone, not merely a shared layout slot. Give
the two strings different identities and resolve their timings so the outgoing text
is fully gone before the incoming one starts. With beat-only timing, require
`incoming delay_beats >= outgoing delay_beats + outgoing duration_beats`; include
the absolute delays in the same comparison when either side uses `delay_ms`. A
shared text identity whose content changes compiles as a cross-fade and cannot
satisfy this invariant. Preserve identity only when the string itself is unchanged.
A changing magnitude is different: model it as one persistent `number` identity so
the value counts without replacing the element.

## How to animate text

Choose the text motion from the event. Use `crop` when text arrives inside a fixed
mask, a short `slide` when it genuinely enters from or exits toward a meaningful
side, and an honest `cut` when immediacy is the point. Keep `fade` or `none` as the
default when no direction is implied and no other string is competing for the same
zone.

A fade becomes mush when one line replaces another in the same position. The two
strings cross-dissolve through each other, the descenders of the outgoing line
overlap the caps of the incoming one, and for a third of a second the audience reads
neither. `crop` avoids that collision when its timings preserve the exclusive zone:
the outgoing line leaves behind its boundary before the incoming one arrives behind
the same boundary. A `cut` is also better than an overlapping fade here; it is
abrupt, but abrupt is a choice the audience can follow.

Fading text out is fine when nothing replaces it. A paragraph that is simply done, a
citation that stops being relevant, a label whose object left — those can dissolve,
because there is nothing behind them for the dissolve to muddy.

## How to animate a figure

A `number` element carries a magnitude, so it can count rather than cut between
two values. Its identity declares `animate_magnitude` as three booleans — `in`,
`morph`, `out` — and the count follows that role's own duration and easing, so
the digits and the movement are on the same curve by construction.

The common shape is `{"in": true, "morph": true, "out": false}`: the figure
counts up when it arrives, counts to its new value when the story updates it, and
simply leaves. Counting out to zero is for the rare edge where the point is that
the quantity is gone.

Count when the magnitude is the argument — a result, a growth, a total the
audience is meant to feel the size of. Do not count a year, a version, a
reference number or an axis label: those are identifiers that happen to be
numeric, and watching them spin reads as a bug. And a figure that does not count
should still not cross-fade between two magnitudes; give it a `crop` so one value
replaces the other behind a boundary.

Keep the box wide enough for the final value. The renderer uses tabular figures
so the digits do not wobble while counting, but it cannot invent room that the
composition never gave the element.

## Where to write each value

- **Presentation**: the deck's rhythm and its default behavior for the three roles.
- **Slide**: how this checkpoint is arrived at or left, when the whole slide differs.
  A section opener that arrives from the right, a conclusion that lingers longer.
- **Element state**: one element whose semantic role differs from the flow, or a
  short delay that makes it land after the element it depends on.

Clearing is first-class: `clear_motion` on a slide or an element removes the patch
and the role inherits again. Prefer clearing over restating an inherited value,
because a restated value stops following the deck when the deck changes.

## Audit playback behavior

For every adjacent checkpoint edge:

1. List persistent, entering and exiting element identities.
2. State the single central motion and the identities allowed to move for it.
3. Compare persistent geometry with the active section contract; flag every
   unexplained delta, even a small one.
4. Resolve each identity's role and read the value it actually inherits: document,
   then slide, then element state, property by property.
5. Predict which motion comes from morph interpolation, from the slide, and from an
   element patch.
6. Play or otherwise inspect the real transition at normal speed.
7. Confirm the visible result matches the prediction and narrative direction and that
   no secondary drift competes for attention.
8. For every pair of different strings whose rectangles overlap across the edge,
   confirm the outgoing text is fully gone before the incoming text starts.
9. If an element merely appears despite a non-`none` inherited animation, treat it as
   a renderer or contract defect. Capture the smallest reproducible edge and fix the
   implementation before compensating with per-element patches.

Respect reduced-motion behavior and ensure the story remains understandable without
animation.
