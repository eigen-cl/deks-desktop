---
name: deks-motion-patterns
description: "A catalogue of reusable DEKS choreographies with the exact commands to build each one: promoting a list item into the next slide's title, staggered entries and exits, text relay in the same position, a progress bar that fills, a figure that counts, accumulation, replacement, a travelling protagonist, curtain and edge reveals, narrative zoom, focus by dimming, before/after, and the persistent object that carries a section. Use it when a checkpoint edge needs a concrete animation rather than a principle: when choosing how one slide should become the next, when a transition looks arbitrary, or when a described effect needs to be turned into commands. Pair with $design-deks-presentations for why a moment deserves motion at all, and $deks-presentations for the contract."
---

# Motion patterns

Each pattern below names a narrative move, says what makes it work, gives the
commands, and says when not to use it.

Read [references/catalog.md](references/catalog.md) for the full catalogue with
worked commands. This page is the index and the two rules that make all of them
behave.

## The two rules everything here depends on

**One: continuity is identity.** An element that has state on both slides of a
boundary continues, and the renderer interpolates between its two states. The same
thing drawn twice under two IDs does not continue — it cross-fades. Every pattern
that transforms something is really a pattern about reusing one `elementId`.

**Two: a discrete change breaks the interpolation.** A continuing text whose
`content`, `fontFamily`, alignment or overflow mode differs between the two states
degrades from one travelling node to two cross-faded nodes, silently, with no error.
Everything else — position, size, colour, weight, letter spacing, line height,
opacity, rotation — interpolates. So a transformation you want the audience to *see*
must keep the string identical and let the geometry carry the change.

## The catalogue

| Pattern | The move it makes |
|---|---|
| **Promotion to title** | One line of a list survives the boundary and becomes the next slide's heading, growing and travelling while its siblings leave. |
| **Staggered exit / staggered entry** | Siblings leave or arrive on a rising `delayBeats`, so the eye reads an order instead of a blink. |
| **Text relay** | One line replaces another in the same place, without the two ever being legible at once. |
| **Progress bar** | A shape interpolates its width across checkpoints, optionally with a figure counting alongside it. |
| **Counting figure** | A `number` whose magnitude animates, from zero on arrival or between two values on a morph. |
| **Accumulation** | Each checkpoint adds one element and moves nothing already on screen. |
| **Replacement** | The old idea leaves and the new one takes its exact place, because it supersedes it. |
| **Travelling protagonist** | One persistent object moves along a route across several checkpoints while everything else stays anchored. |
| **Curtain reveal (wipe)** | Something already present is uncovered in place. |
| **Edge reveal (crop)** | Something new arrives from behind its own boundary, without fading. |
| **Narrative zoom** | The frame goes from the whole picture to one detail, by scale and anchor rather than by cutting to a new scene. |
| **Focus by dimming** | What is no longer the point drops in opacity instead of leaving. |
| **Before and after** | Two states of the same object, compared by morph. |
| **Section protagonist** | One icon or object persists through a whole section and changes state at each checkpoint, carrying the thread. |

## Choosing one

Ask what changed in the argument, not what would look good:

- The same thing, now more important → **promotion**, **narrative zoom**, **focus by dimming**.
- The same thing, in a new state → **before and after**, **counting figure**, **progress bar**, **section protagonist**.
- A different thing, in the same role → **text relay**, **replacement**.
- More things, same frame → **accumulation**, **staggered entry**.
- Something that was always there, now shown → **curtain reveal**.
- Something genuinely new arriving → **edge reveal**, **staggered entry**.
- Something that moves in the story → **travelling protagonist**.

If none of these fits, the honest answer is usually that the edge needs no motion at
all beyond the deck's inherited default. An animation with no referent in the
argument is noise, and the audience will spend attention decoding it.

## Where the examples are written

`references/catalog.md` writes every example in the **DEKS Core envelope** —
kebab-case `type`, camelCase payload — because that is the shape the document itself
has, and it is what the Desktop MCP takes literally. On Cloud, translate: the
envelope becomes `{"command": …, "arguments": {…}}` and every field becomes
snake_case. `$deks-desktop-mcp` → `references/commands.md` has the full mapping
table.
