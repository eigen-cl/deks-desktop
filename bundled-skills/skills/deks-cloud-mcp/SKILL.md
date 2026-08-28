---
name: deks-cloud-mcp
description: "Operate the DEKS Cloud MCP server at api-deks.eigen.cl: OAuth or workspace PAT, the full tool map (presentations, slides, elements, motion, palettes, the searchable and paged offline Lucide catalog, asset upload, layout validation, rendered previews, publication, export, undo), the exact apply_commands envelope in snake_case, revisions and idempotency keys, workspace assets, the 50-checkpoint and 100-state quotas, and what each error code means. Use it whenever the discovered tools include validate_layout, recommend_palettes, upload_asset, publish_presentation or export_deck, or whenever the deck lives in a workspace rather than in a local `.deks` file. Pair with $deks-presentations for the document contract itself."
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

## Keep remote round trips semantic

In ChatGPT and other remote clients, use `apply_commands` as the default write path
for a coherent checkpoint or short narration. Put related identity declarations,
states, styling and motion in one atomic batch instead of calling one mutation tool
per element or property. A batch is a semantic transaction, not merely a container:
do not combine unrelated narrations, external publication or destructive cleanup to
save calls, and keep it at or below 100 operations.

Read the revision before planning the first transaction. After a confirmed batch,
carry its returned revision into the next transaction and give that next batch a new
semantic `idempotency_key`; do not move `expected_revision` or the key inside the
commands. Re-read on a conflict, an uncertain response, or whenever authoritative
state may have changed — batching never relaxes revision or recovery rules.

Validate and render the coherent result: complete one checkpoint or narration,
validate it, then render its affected checkpoints once. Do not validate or render
after each property mutation. Re-render checkpoints changed by a correction batch,
and run whole-deck validation plus ordered rendered review at the end.

## The loop

1. `list_presentations` to resolve the deck, then `get_presentation` immediately
   before planning any mutation. Capture the revision.
2. `list_assets` before requesting new media. Reuse a matching admitted asset when
   one exists. When the user has explicitly attached a file, call `upload_asset`
   once and reuse the returned `id` as the image state's `asset_id`; never invent file bytes, a local path,
   or a URL. If the user only mentions a file or path, ask them to attach it before
   calling the tool. Uploaded media passes the shared image admission contract.
3. Plan the change. Group each coherent checkpoint or narration into one
   `apply_commands` batch of at most 100 operations; a failed batch is atomic and
   leaves the revision untouched. Prefer this over element-by-element mutation tools.
4. Send the exact latest `expected_revision` and one semantic `idempotency_key` per
   intended transaction. Continue from the revision the response returns.
5. `validate_layout` after each coherent checkpoint or narration transaction and
   again over the whole deck, not after each property. Carry the confirmed returned
   revision between transactions.
   Treat errors and unintended outside-canvas geometry as blockers.
6. `render_slide_preview` once the affected checkpoint is coherently composed, at
   the confirmed revision, and actually look at the image. Re-render after a
   correction batch; do not render between individual property mutations.
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

Cloud workspace asset count and storage quotas belong to the account plan and
are separate from the shared per-image bounds and the portable file format. Read
the current quota reported by the product instead of inferring it from a `.deks`
file. The 20 MB MCP `export_deck` ceiling is a base64 response-transport guard;
it does not reduce the 95 MB physical / 90 MB uncompressed `.deks` contract used
by Web, Cloud import/export and Desktop.

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
