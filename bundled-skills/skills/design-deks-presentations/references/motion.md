# Motion as narrative

## Establish the base rhythm

Set one `motion_beat_ms` for the presentation. Use it as the semantic unit of time:

- `1.0x`: normal checkpoint work;
- `0.5x` or `0.75x`: supporting changes and quick acknowledgements;
- `1.5x` or `2.0x`: deliberately weighty transformations.

Avoid arbitrary milliseconds per element. Keep stagger short and purposeful so the audience can connect cause and effect.

## Let slide defaults carry the flow

Set `in_preset` and `out_preset` on slides as the base presence behavior. Most destination-only and source-only elements should inherit those defaults. Shared elements should retain identity and animate through geometry or state changes.

Use fade or `none` as the normal presence behavior for titles, body text, labels, citations, and supporting copy. Text may enter, exit, or remain; do not make it travel merely because the composition changes between checkpoints.

Before authoring motion, write a section contract with:

- the identities that persist through the section;
- their anchored position and scale;
- the local elements that may enter or exit;
- the section-boundary transformation that can justify re-anchoring.

Do not animate responsive re-layout. If a continuing object moves a few pixels only to balance the next static composition, keep it on its section anchor and arrange the local content around it.

For every edge, name one central motion in a short causal phrase such as `the route branches`, `the barrier blocks the approved path`, or `the pilot perimeter encloses the route`. By default animate only one or two focal story elements. A tightly coupled group may move together when it reads as that same action; unrelated interpolation is jitter and must be removed.

Use an element-specific presence override only when its semantic role differs from the base flow:

- use a glide when an object is displaced, transferred, or arrives from a meaningful direction;
- use a fade when an idea is restated, revealed, or changes emphasis without implied movement;
- use `none` only when an instantaneous change is intentional.

Use `set_transition_override` only for timing that differs on one edge or to disable a shared animation. Do not configure every element individually: that makes motion brittle and hides default-motion defects.

## Audit playback behavior

For every adjacent checkpoint edge:

1. List persistent, entering, and exiting element identities.
2. State the single central motion and the identities allowed to move for it.
3. Compare persistent geometry with the active section contract; flag every unexplained delta, even a small one.
4. Check every entering identity against the destination slide's `in_preset` and every exiting identity against the source slide's `out_preset`. A `none` default means a cut unless an intentional element override supplies motion.
5. Predict which motion comes from shared interpolation, slide defaults, and explicit overrides.
6. Play or otherwise inspect the real transition at normal speed.
7. Confirm the visible result matches the prediction and narrative direction and that no secondary drift competes for attention.
8. If an element merely appears despite a non-`none` inherited preset, treat it as a renderer/product defect. Capture the smallest reproducible edge and fix the implementation or contract before compensating with unnecessary per-element overrides.

Respect reduced-motion behavior and ensure the story remains understandable without animation.
