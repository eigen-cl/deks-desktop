# The motion contract

This is what the values mean and what they are allowed to be. For *which* animation
a given narrative moment deserves, read `$design-deks-presentations`; for ready-made
choreographies, read `$deks-motion-patterns`.

## Three roles, decided by presence

At a boundary between two adjacent slides, every element plays exactly one role, and
the role follows from where it has state:

- **`in`** — it has state only on the second slide. It arrives.
- **`out`** — it has state only on the first slide. It leaves.
- **`morph`** — it has state on both. It continues.

You do not choose the role. You choose whether an identity continues, and the role
follows. An element that continues must not be given `in` on the arriving slide or
`out` on the leaving one: those patches are dead weight that misleads the next
reader.

A `morph` is resolved from the slide the element is arriving at.

## Four properties per role

| Property | Meaning |
|---|---|
| `animation` | One object, discriminated by `kind`. |
| `durationBeats` | A multiple of `motionBeatMs`. 0 to 8. |
| `delayBeats` | A multiple of `motionBeatMs`. 0 to 16. |
| `delayMs` | Absolute milliseconds. 0 to 60 000. |
| `easing` | `linear`, `ease-in`, `ease-out`, `ease-in-out`, or `[x1,y1,x2,y2]` with both x within 0..1. |

**The two delays add.** The wait is `motionBeatMs * delayBeats + delayMs`. They are
two units on purpose. `delayBeats` is musical: `1` waits exactly as long as a
one-beat animation takes, so "start when the previous one ends" stays true after
someone changes the deck's tempo. `delayMs` is absolute, for an offset that is about
a specific instant rather than about the rhythm.

Write chains in beats. A staircase written in milliseconds falls silently out of
step the day `motionBeatMs` changes, and nothing fails — it just stops reading as a
staircase.

## The animations

Presence animations, for `in` and `out`:

- `{"kind": "none"}` — instantaneous. A deliberate cut.
- `{"kind": "fade"}` — opacity only.
- `{"kind": "slide", "edge": "left|right|top|bottom", "distance": 240}` — travels
  from or towards an edge, and fades. **Without `distance` it travels until it is
  completely off the canvas**, which for an element near the far edge means crossing
  the whole slide. Give a distance whenever you mean a nudge rather than an exit.
- `{"kind": "crop", "edge": …}` — the element's own rectangle masks it and the
  content travels inside it. The box never moves and opacity is never touched, so it
  reads as revealed from behind a boundary. Takes no distance: the travel is exactly
  the element's own extent on that axis.
- `{"kind": "wipe", "edge": …}` — the opposite. Nothing moves; the mask edge travels
  across a stationary element, uncovering it on the way in and covering it on the way
  out. Also no distance.
- `{"kind": "scale", "from": 0.9}` — starts smaller or larger, in place, and fades.
  Factor between 0.01 and 10.

Continuity animations, for `morph` only:

- `{"kind": "morph"}` — interpolate between the two states.
- `{"kind": "cut"}` — snap.

`none` and `cut` both resolve to a zero-length transition.

## Inheritance: document ← slide ← element state

The document carries one **complete** declaration of all three roles. It is the only
complete one. A slide and an element state carry **patches**: every property they
omit keeps resolving from the level above, one property at a time. A slide that sets
only `in.easing` still inherits `in.durationBeats` from the document.

Write the exception where it belongs:

- **Document** — the deck's rhythm and its default behaviour. Most elements should
  need nothing else.
- **Slide** — when the whole checkpoint arrives or leaves differently.
- **Element state** — when one element's semantic role differs from the flow, or
  when it must land after the element it depends on.

Clearing is first-class. Drop a slide or element patch and the role inherits again.
Prefer clearing to restating an inherited value: a restated value stops following the
deck the day the deck changes. The presentation scope cannot be cleared — it is what
everything else inherits.

## Reading what actually plays

To predict a transition, for each identity: determine its role from presence, then
resolve each of the four properties document → slide → element state, property by
property. Then check the discrete-change rules in
[document-model.md](document-model.md): a `morph` whose element changed something
discrete plays as a cross-fade of two nodes, not as one node interpolating, whatever
the `morph` animation says.

Reduced motion is honoured by the renderer. The story must remain understandable
with every animation removed.
