---
name: design-deks-presentations
description: "An opinionated method for making a presentation: abstracting a subject into topics, treating each topic as a narration with its own opening, development and close, deciding what deserves to move and what must stay still, choosing which animation a moment means (fade, slide, crop, wipe, scale, morph, cut), setting one rhythm and chaining with beats, and building a coherent palette, typography, composition and evidence — then auditing the rendered result. Use it whenever you are creating, improving or reviewing a DEKS deck without a complete user-supplied presentation guide, when a deck looks confusing or arbitrary, when a palette must be chosen or completed, or when choreography needs semantic review. Pair with $deks-motion-patterns for concrete choreographies and $deks-presentations for the contract."
---

# Designing a DEKS presentation

Design one evolving argument, not a pile of slides. This skill is the method. For
the exact tools of your host use `$deks-cloud-mcp` or `$deks-desktop-mcp`; for the
contract use `$deks-presentations`; for a concrete choreography use
`$deks-motion-patterns`.

Read only the reference you need:

- [references/narrative.md](references/narrative.md) — topics, narrations, and the two kinds of transition. **Read this first for any new deck.**
- [references/story-and-evidence.md](references/story-and-evidence.md) — proposal structure, sources, claims.
- [references/visual-system.md](references/visual-system.md) — palette, typography, composition, icons.
- [references/motion.md](references/motion.md) — what each animation means and how to choreograph an edge.
- [references/audit.md](references/audit.md) — geometry, DOM, rendered and human QA.

## Think of it as a narration, not as a set of slides

A presentation is an argument that advances. Each checkpoint exists because
something in the argument changed — a claim was made, a consequence appeared, a
tension resolved. If you can reorder two checkpoints without loss, one of them is
not carrying its weight.

The unit of work is not the slide. It is the **narration**: a short arc with an
opening, a development and a close, spanning two to five checkpoints. A deck is a
handful of narrations placed in an order that makes the last one inevitable.

## Abstract the subject into topics

Before composing anything:

1. **Name the decision.** Who is in the room, what they should do differently
   afterwards, how long you have, and what standard of evidence they will accept.
2. **Break the subject into three to six topics.** Not sections of a document —
   topics of an argument. Each one is a thing you would have to convince someone of
   separately.
3. **Turn each topic into a narration.** What does it open on, what does it develop,
   what does it leave the audience holding? A topic that cannot be told as a small
   story is usually two topics, or none.
4. **Order the narrations** so each one creates the question the next one answers.
5. **Then** storyboard checkpoints inside each narration.

Every new deck or complete rewrite opens with a minimal cover, and the story
establishes context before it introduces the proposal, product, architecture or
demo. `cover → context → proposal` is a required ordering; the beats between context
and proposal follow whatever narrative form you chose.

## The two kinds of transition

This distinction governs every motion decision you will make.

**Advancing inside a narration — continuity.** The scene does not change. Persistent
identities keep their anchor geometry. Changes are small, legible and causally
connected: a state changes, an item is added, a figure updates, one object moves and
explains why. The background stays. The audience should feel they are still looking
at the same thing.

**Moving from one narration to the next — scene change.** Here you are allowed to
recompose: change the anchor, change the background, bring a block in and take a
block out. This is where a bigger gesture earns its place, and it is the only place
where re-anchoring a persistent object does not read as drift.

Most defects in animated decks come from confusing the two — recomposing inside a
narration, so persistent objects wander for no reason; or changing nothing at a
narration boundary, so two arguments blur into one.

## What to animate, and what must stay still

- **One or two focal elements per checkpoint.** Name the edge's single central
  motion in a short causal phrase — *the route branches*, *the item becomes the
  claim*, *the bar reaches the target*. If you cannot say it in a phrase, the edge
  has no motion, only movement.
- **Ordinary text has no universal entrance.** Keep `fade` or `none` as the default
  when the argument implies no direction. Use a short `slide` when lateral arrival
  or departure carries meaning, and `crop` when the text should travel inside its
  fixed mask. A `wipe` is different: the text stays fixed while the mask edge
  uncovers it. None of these licenses travel caused only by rebalancing the layout.
- **Stagger follows visual bands, not element count.** Group elements by their
  rendered vertical bounds and text baselines before assigning delays. Elements on
  the same row or baseline should normally start together; stagger the bands in the
  intended reading direction. Split one band only when the content itself has a
  sequential relationship.
- **A text rectangle is an exclusive temporal zone.** When a different string will
  reuse any part of it, give the replacement a different identity and finish the
  outgoing text before the incoming text begins. A shared text identity whose
  content changes cross-fades both strings, so it cannot keep that zone clean;
  preserve identity only while the string itself remains unchanged.
- **Never animate re-layout.** A continuing element that shifts twelve pixels to
  balance the next composition is visible motion with no referent. Keep it on its
  anchor and arrange the local content around it.
- **Stillness is a choice.** A checkpoint where only one thing changes is stronger
  than one where six things ease into place.

## Which animation a moment means

| The moment | Reach for |
|---|---|
| No direction or boundary is implied; the change may stay quiet | `fade` or `none` |
| A real displacement or transfer — something arrives from a meaningful direction | `slide`, with a `distance` unless it truly leaves the story |
| New text or a figure arrives inside its stationary box, as if from behind its boundary | `crop` |
| Something that was always there, now uncovered — a chart drawn, a rule that draws itself | `wipe` |
| An object being presented, landing, or magnified in place | `scale`, `from` 0.8–0.95 |
| The same object in a new state | `morph` — that is, one identity with two states |
| A deliberate break the audience should feel as a cut | `none` / `cut` |

Two rules that come from how text renders, not from taste: **two fading strings must
not share a zone**, because their letterforms cross-dissolve into an unreadable third
state. This is worst when one line replaces another in the same place. And **a figure
that means a quantity should count**, while a figure that is an identifier — a year,
a version, a reference number — must not.

## One rhythm for the whole deck

Choose `motionBeatMs` once. Treat one beat as the normal duration for checkpoint
work; 0.5–0.75 for supporting changes, 1.5–2 for a deliberately weighty
transformation.

Chain with `delayBeats`, not milliseconds: a beat-based delay means "start when the
previous one ends" and stays true after someone changes the tempo. Use `delayMs`
only for an offset that is genuinely about a specific instant.

Set the presentation motion as the base flow and patch a slide or an element only
where the story asks for an exception. Most elements should inherit everything. Clear
a patch rather than restating an inherited value.

## Keep the visual world still while the argument moves

- One coherent visual world for the whole deck. The background and visual direction
  hold until the narrative truly changes scene.
- A small palette used as roles, not as permission to colour every object
  differently. Let an explicit brand win; without one, ask for palette
  recommendations and choose deliberately, then persist every role. Reserve green,
  red and yellow for success, failure and attention.
- One focal idea per checkpoint, and usually one or two newly introduced elements.
- Continue conceptual objects through stable identities. Change state, position,
  emphasis or relationship — do not rebuild the scene.
- For a proposal, close with the exact decision requested and the smallest credible
  pilot that produces evidence for the next one. Never invent dates, counts, targets,
  budgets or thresholds.

## Work in one loop, not in phases

Implement one narration, then validate and render it immediately. Let what you see
drive the next one. Do not compose the whole deck and audit at the end — by then
every defect is structural.

Finish with evidence: geometry validation, complete DOM measurement coverage where
the host offers it, and a rendered review of every checkpoint at the current
revision, watched **in order**. A configured animation that simply appears is a
defect until you have seen it play. Distinguish rendered QA from human presentation
QA, and report what remains unresolved.
