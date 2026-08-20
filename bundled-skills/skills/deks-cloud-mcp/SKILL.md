---
name: deks-cloud-mcp
description: "Operate the DEKS Cloud MCP server at api-deks.eigen.cl: OAuth or workspace PAT, the full tool map (presentations, slides, elements, motion, palettes, icon catalog, layout validation, rendered previews, publication, export, undo), the exact apply_commands envelope in snake_case, revisions and idempotency keys, workspace assets, the 50-checkpoint and 100-state quotas, and what each error code means. Use it whenever the discovered tools include validate_layout, recommend_palettes, publish_presentation or export_deck, or whenever the deck lives in a workspace rather than in a local folder. Pair with $deks-presentations for the document contract itself."
---

# Operate the DEKS Cloud MCP

Endpoint: `https://api-deks.eigen.cl/mcp/`.

The document contract — what the fields mean and what values they take — lives in
`$deks-presentations`. This skill is only about reaching it through this server.

- Read [references/tools.md](references/tools.md) for the exact tool map, inputs, outputs, and unsupported operations.
- Read `$deks-presentations` → `references/recovery.md` before retrying anything uncertain.

## Authenticate

Shared installations use the server's MCP OAuth flow (OAuth 2.1 with PKCE); access
is scoped to one workspace and to `read` and/or `write`, and is revocable.

A direct development or CLI connection may instead send
`Authorization: Bearer deks_pat_...`. PATs are workspace-bound, shown once, hashed at
rest, and revocable. Never embed a PAT in a distributed plugin, and never request,
echo, or write a token into chat, logs, files, or command output.

If a write returns a scope error, say the connection lacks write access. Do not
retry it as a read or look for another route.

## Discover before you call

Treat the tools the server actually advertises as the source of truth, together with
their `readOnlyHint`, `openWorldHint`, and `destructiveHint` annotations. Do not rely
on a hard-coded tool count, and do not call a tool named in this file if discovery
does not list it.

## The loop

1. `list_presentations` to resolve the deck, then `get_presentation` immediately
   before planning any mutation. Capture the revision.
2. `list_assets` before asking for media. **The MCP does not upload assets** — ask
   the user to upload them in the web app.
3. Plan the change. Group coherent edits into one `apply_commands` batch of at most
   100 operations; a failed batch is atomic and leaves the revision untouched.
4. Send the exact latest `expected_revision` and one semantic `idempotency_key` per
   intended transaction. Continue from the revision the response returns.
5. `validate_layout` after each coherent checkpoint and again over the whole deck.
   Treat errors and unintended outside-canvas geometry as blockers.
6. `render_slide_preview` on every checkpoint you touched, at the freshly read
   revision, and actually look at the images.
7. Re-read and report the final revision, the QA level reached, remaining
   intentional warnings, and anything you could not do.

## Quotas that are not document limits

The server enforces at most **50 checkpoints per presentation** and **100 rendered
element states per checkpoint**; a shared identity counts once on each checkpoint
where it has state. Crossing either returns `resource_limit_reached` without
mutating, and an atomic batch that would cross it rolls back completely.

These are internal complexity guardrails, not user-facing copy. Mention a bound only
when it constrains planning or rejects a write. Never delete older checkpoints or
elements to make room, and never split a narrative silently — ask the user.

## External and destructive changes

`publish_presentation`, `rotate_presentation_publication`, `unpublish_presentation`,
`delete_presentation`, `delete_slide`, and `delete_element` change state outside the
document or destroy history. Perform one only on an explicit user request, re-read
the exact target immediately beforehand, and never auto-retry after an uncertain
response.

Publishing does not snapshot: the public link shows the deck's current revision.

## Errors

| Response | What it means | What to do |
|---|---|---|
| Success with a revision | Committed. | Continue from the returned revision. |
| Validation failure | The request was wrong; an atomic batch changed nothing. | Fix the request. |
| Revision conflict | Someone else wrote first. | Re-read, reconcile, issue a **new** transaction with a **new** key. |
| `resource_limit_reached` | A quota above would be crossed; nothing mutated. | Replan or ask the user. Do not delete to make room. |
| Scope error | The connection lacks `write`. | Say so. Do not work around it. |
| 429, 5xx, timeout, disconnect, malformed | **Uncertain.** | Do not mutate again. Follow the recovery procedure. |
