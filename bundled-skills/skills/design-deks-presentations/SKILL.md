---
name: design-deks-presentations
description: "Design, improve, and audit persuasive DEKS presentations with an opinionated story-first method for narrative structure, cohesive palette selection, typography, composition, evidence, checkpoint continuity, motion rhythm, and rendered QA. Use when creating a deck without a complete user-provided presentation guide, when a DEKS presentation looks confusing or visually weak, when choosing or completing a palette from partial colors, when choreography needs semantic review, or when auditing an evolving live deck. Pair with $deks-presentations for exact MCP operations and safety contracts."
---

# Design DEKS presentations

Design one evolving visual argument, not a collection of unrelated slides. Pair this method with `$deks-presentations`; let that skill govern current MCP schemas, revisions, transactions, limits, and recovery.

For every new presentation or complete rewrite, begin with a minimal cover. The story starts after the cover and must establish context before it introduces the proposal, product, architecture, or demo. Treat `cover -> context -> proposal` as a required ordering contract; the beats between context and proposal remain adaptable to the chosen narrative form.

## Run one continuous design loop

1. Define audience, desired decision or behavior, delivery duration, narrative spine, and evidence standard.
2. Inspect the live deck before planning. Audit its story, palette, composition, identities, motion, geometry, DOM measurements, and rendered sequence.
3. Divide the narrative into coherent sections. For each section, define the persistent story elements, their anchor geometry, and the scene change that justifies entering or leaving the section.
4. Choose one coherent visual world and one presentation motion beat. Storyboard each checkpoint as a meaningful state change within that world and name one central motion for every edge.
5. Implement one coherent scene or narrative beat through DEKS, then validate and render it immediately.
6. Let findings drive both the next checkpoint and any in-scope tooling improvement. If the renderer or MCP lacks evidence needed for an honest audit, diagnose that capability, fix it with contract tests, and return to the same live deck; do not postpone presentation quality to a separate final phase.
7. Repeat until the story is understandable in order, every required visual change is visible in playback, and the ending asks for the intended decision.

Read only the references needed for the task:

- Read [references/story-and-evidence.md](references/story-and-evidence.md) for narrative, proposal structure, sources, and claims.
- Read [references/visual-system.md](references/visual-system.md) for palette, typography, composition, and icon choices.
- Read [references/motion.md](references/motion.md) before choreographing or auditing transitions.
- Read [references/audit.md](references/audit.md) for geometry, DOM, rendered, sequence, and human QA.

## Make checkpoint changes legible

- Give each checkpoint one focal idea and usually one or two newly introduced focal elements.
- Continue conceptual objects through stable identities. Change state, position, emphasis, or relationships instead of rebuilding the whole scene.
- Keep continuing objects on their section anchors. A small per-slide layout nudge is still visible motion; recompose local content around the anchor instead of making a protagonist, document, route, or icon wander without cause.
- Keep the background and visual direction stable until the narrative truly changes scene.
- Let ordinary text enter, exit, or remain with fade or no movement. Reserve travel and geometry interpolation for the story objects whose motion explains the checkpoint.
- Assign one central motion to every checkpoint edge. Animate one or two focal elements by default; treat a tightly coupled set as one motion only when every member participates in the same causal action.
- Prefer visible causality: left-to-right, top-to-bottom, accumulation, replacement, or state change. Do not rely on narration to explain an arbitrary layout jump.
- For a proposal, close with the exact decision requested and the smallest credible pilot that produces evidence for the next decision. Never invent dates, counts, targets, budgets, or thresholds.

## Choose a restrained palette

- Let an explicit brand or user guide win.
- Without one, ask `recommend_palettes` for multiple examples that match intent and light/dark mode. Choose deliberately from the examples based on tone, contrast, and subject; do not accept the first result mechanically.
- When the user supplies any subset of `background`, `primary`, or `secondary`, call `complete_palette` to preserve those anchors and complete the six presentation roles. Persist every completed role with `set_presentation_palette`; explicit existing colors require separate restyling. If the anchors cannot satisfy required contrast, surface the conflict rather than silently changing them.
- Keep the working palette small and visually related. Use background, text, subtext, primary, secondary, and at most one accent as roles, not as permission to color every object differently.
- Reserve green, red, and yellow for success, failure, and attention by default. Adapt this convention when culture, accessibility, or a supplied brand system requires another semantic mapping, but never use those semantic colors decoratively in a way that obscures status.
- Apply paired foreground roles from the recommendation or completion result and verify actual rendered pairings.

## Choreograph one base rhythm

- Choose `motion_beat_ms` once for the presentation. Treat `1.0x` as the normal duration for checkpoint work.
- Set slide entry and exit presets as the base presence flow. Most entering and exiting elements should inherit these defaults.
- Use stable identity and geometry interpolation for elements that persist.
- Override an individual element only when its narrative meaning differs from the base flow. For example, fade a restated idea that remains the same conceptual point; glide an object when the story describes displacement or transfer.
- Audit actual playback. A configured animation that simply appears is a defect or contract mismatch until verified, not evidence that the audience saw the intended transition.

## Finish with evidence

- Require geometry validation, complete DOM measurement coverage, and rendered review of every checkpoint at the current revision.
- Review the ordered sequence and actual transitions, not only isolated PNGs.
- Distinguish rendered QA from human presentation QA.
- Report unresolved claims, unavailable diagnostics, intentional warnings, and any product defect that still affects the story.
