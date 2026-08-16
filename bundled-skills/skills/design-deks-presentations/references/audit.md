# Presentation audit

## Report the achieved QA level

1. **State inspection** — element properties and identities read.
2. **Geometry validation** — authored bounds and estimated layout reviewed.
3. **Rendered review** — current renderer output inspected checkpoint by checkpoint and as an ordered sequence.
4. **Motion review** — actual adjacent transitions inspected at presentation speed.
5. **Human presentation QA** — a person reviewed the delivered deck and playback.

Never call levels 1 or 2 polished visual review. Do not call isolated PNG inspection a motion review.

## Audit the live deck

1. Read the exact current revision and expected rendered element IDs.
2. Inspect story order, section boundaries, section anchor contracts, focal idea per checkpoint, persistent identities, evidence, and decision close.
3. Run `validate_layout`; fix errors and unintended outside-canvas geometry. Inspect collision warnings by semantic names rather than dismissing them in bulk.
4. Render every checkpoint at the current revision.
5. Require `layout_measurements_available: true` and exact unique measurement coverage before using DOM diagnostics. Only complete coverage plus an empty `overflow_element_ids` supports a no-overflow conclusion.
6. Inspect actual line wrapping, clipping, hierarchy, contrast, alignment, rhythm, palette consistency, icon scale, gradients, and asset crops in each PNG.
7. Inspect the ordered contact sheet or sequence for continuity and visual pacing.
8. Build an edge motion ledger. For every adjacent transition, name its single central motion; list the persistent identities allowed to move; compare all other shared geometry to the section anchors; and remove unexplained jitter. Cross-check each entering identity against the destination `in_preset` and each exiting identity against the source `out_preset`; flag a `none` default when visible motion was intended. Confirm non-`none` defaults actually affect presence motion and that overrides have a narrative reason.
9. Correct the issue, re-read the resulting revision, and re-run the affected geometry, DOM, render, and motion checks.

Estimated text bounds are conservative signals, not browser measurements. A clean geometry result cannot establish typography, contrast, crop quality, or motion. If DOM diagnostics or playback inspection are unavailable, state the limitation rather than inferring success.

## Feed defects back into the product

When a live-deck audit exposes a missing tool or renderer defect:

1. Reduce it to a concrete authored state and expected observable behavior.
2. Preserve the deck as the diagnostic fixture when safe; do not redesign around the defect.
3. Add an integration or contract test at the owning product layer.
4. Implement the smallest durable capability or fix.
5. Re-run the product tests and return to the same deck edge.
6. Re-render or replay the corrected result before continuing the narrative.

Keep deck improvement and tooling evolution in one feedback loop, while preserving separate revisions, tests, and releases for each repository.
