# Topics, narrations, and the two kinds of transition

## Why the slide is the wrong unit

A slide is a page. An argument is not made of pages, and a deck built page by page
ends up as a document read aloud: every checkpoint independently composed, nothing
carrying over, and motion applied afterwards as decoration.

Work at two levels above the slide.

**Topic** — one thing you would have to convince someone of on its own. Between
three and six for a deck. If two topics always appear together in your reasoning,
they are one topic. If a topic needs a caveat before it can be stated, the caveat is
a topic.

**Narration** — how a topic is told: an opening that creates a question, a
development that answers it, a close that leaves something the audience carries into
the next narration. Two to five checkpoints. A topic that cannot be told this way is
usually a fact, not an argument, and belongs inside another narration as evidence.

Then, and only then, checkpoints.

## Abstracting a subject into topics

Start from the decision, not from the material. Write one sentence: *after this, they
should ___.* Everything that does not move someone towards that sentence is
background reading, not a topic.

Then decompose. Useful cuts, in rough order of how often they work:

- **By obstacle** — what stands between here and the decision. One topic per
  obstacle, in the order the audience will raise them.
- **By stage** — how the thing moves through time: before, during, after. Natural for
  a process, a migration, a rollout.
- **By actor** — who does what and what changes for each. Natural when the decision
  affects several groups differently.
- **By layer** — surface, mechanism, foundation. Natural for a technical
  architecture, dangerous elsewhere because it flatters the speaker's mental model
  rather than the audience's question.
- **By claim** — one topic per assertion you must defend. Natural for a proposal
  under scrutiny.

Then order them so each narration's close creates the opening of the next. If you can
swap two narrations without the deck getting worse, one of them is not load-bearing.

## Shaping one narration

A narration needs three moments. They do not need three checkpoints — an opening and
a close can share one — but all three must be present.

**Opening.** Put the audience in a state of wanting. A tension, a number that does
not add up, a situation they recognise. Introduce the objects the narration will use;
this is where new identities appear.

**Development.** The state changes. Something moves, accumulates, resolves, or is
revealed. This is where the motion belongs, because this is where the argument is
actually happening. Keep the cast fixed: introducing new objects mid-narration
restarts the audience's orientation.

**Close.** Land the point in one sentence and hand something forward. A close that
merely stops is why decks feel like lists.

A narration whose development has no state change is a static claim with slides
around it. Either find the change, or fold the topic into another narration as a
single evidence checkpoint.

## The two kinds of transition

Every boundary between adjacent checkpoints is one of two things, and confusing them
is the most common cause of a deck that feels arbitrary.

### Advancing inside a narration — continuity

The scene does not change. What is true here:

- Persistent identities keep their **anchor geometry**. The same object is in the
  same place, at the same scale, unless its movement *is* the point.
- The background does not change. Neither does the visual direction.
- Changes are small, legible and causally connected: a state changes, an item is
  added, a figure updates, one object travels and the travel means something.
- One central motion for the edge, one or two elements participating.
- Text arrives, leaves or stays. It does not drift.

The patterns that live here: accumulation, progress, counting, before/after, focus by
dimming, the travelling protagonist, the section protagonist. See
`$deks-motion-patterns`.

The failure mode here is **drift**: recomposing each checkpoint independently, so
persistent objects shift a little every time to balance the new layout. Each shift is
visible motion the audience tries to interpret, and there is nothing to interpret.
Fix it by writing a section contract before authoring — the identities that persist,
their anchor, the local elements allowed to enter and leave — and holding to it.

### Moving from one narration to the next — scene change

Here you are allowed to recompose, and you should. What becomes available:

- Re-anchoring persistent objects, because the scene genuinely changed.
- Changing the background or shifting the visual register, if the new narration is a
  different kind of thing.
- Bringing a block in and taking a block out, rather than editing in place.
- A larger, slower gesture — this is where 1.5 or 2 beats earn their place.

The patterns that live here: promotion to title, replacement, staggered exit followed
by staggered entry, narrative zoom, curtain reveal of a new frame.

The failure mode here is **flatness**: the boundary between two arguments looks
exactly like the boundary between two steps of one argument, so the audience never
registers that a new topic started. If every edge in a deck has the same weight, the
deck has no structure the audience can feel.

A useful discipline: make the scene change *carry* something across. A promotion —
one line of the closing checkpoint becoming the next narration's title — is a scene
change and a thread at the same time, which is exactly why it is the strongest
opening move in the catalogue.

## Storyboarding a narration before you build it

For each narration write down, in this order:

1. The question it opens on.
2. The persistent identities and their anchor geometry.
3. Per checkpoint: the one focal idea, the one or two new elements, and the single
   central motion at the edge that precedes it, phrased causally.
4. What the close hands to the next narration.

Then check it against three questions:

- **Can it be reordered?** If yes, the causality is not there.
- **Does every edge have a referent?** If an edge's central motion cannot be named as
  something that happens in the argument, remove the motion and let the deck's
  inherited default carry it.
- **Does it survive without animation?** Reduced motion is honoured by the renderer,
  and a story that only works when it moves does not work.

## Where a narration meets the checkpoint budget

Hosts cap checkpoints (Cloud at 50). A deck of five narrations at four checkpoints
each plus a cover is twenty-one — comfortable. If you are pressing against a limit,
the problem is almost never the limit: it is a narration that has become a document
section. Cut the topic, not the story.
