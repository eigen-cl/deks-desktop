# Write recovery and transaction journal

Applies to both hosts. Where they differ, the difference is named.

## Journal each mutation

Before sending a write, retain:

- the presentation ID and the pre-write revision;
- the semantic intent and the exact command batch;
- the unique idempotency key;
- the objects or states you expect to exist afterwards.

After success, retain the returned revision and, where the host returns one, the
transaction ID. Reuse an idempotency key only for the exact same request — both hosts
reject a reused key whose payload differs.

## Classify the response

- **Success with a revision** — committed. Continue from the returned revision.
- **Validation failure** — the request was wrong. An atomic batch changed nothing and
  the revision did not advance. Fix the request.
- **Revision conflict** — someone wrote first. Re-read, reconcile their work, then
  issue a **new** semantic transaction with a **new** key. Never re-send the old
  batch against the new revision without re-reading what changed.
- **Quota rejection** (Cloud `resource_limit_reached`) — nothing mutated. Replan or
  ask the user. Never delete existing content to make room.
- **`path_not_authorized`** (Desktop) — the project resolves outside the folder the
  user authorized. Not retryable. Ask the user to authorize or open that folder in
  the app.
- **429, 5xx, timeout, disconnect, or a malformed response** — the result is
  **uncertain**. Do not mutate again yet.

## Resolve an uncertain result

1. Re-read the presentation.
2. Compare the observed revision and state with the journal.
3. Revision advanced **and** the intended state is present → the write succeeded.
4. Revision did not advance **and** the state is absent → retry the exact request
   with the original idempotency key.
5. State is mixed, unrelated edits intervened, or it is still ambiguous → reconcile
   from the fresh state and create a new transaction. Do not guess.

Never auto-retry a destructive or externally visible operation after an uncertain
response. Re-read the exact target first, and say what you found before acting.

## Recover a partial deck

Read the ordered checkpoints, the element identities, and the boundaries. Compare
them with the storyboard and the journal. Resume from the first missing coherent
narration rather than rebuilding completed checkpoints — rebuilding is how a stable
identity gets replaced by a lookalike and a morph silently becomes a cross-fade.

Cloud offers `undo_transaction`; use it only for a known transaction ID or the newest
confirmed mistaken transaction. Desktop has no undo tool: correct forward with a new
batch.

Keep batches at or below 100 commands. After repeated 429 or 5xx responses, reduce
the batch size, and stop entirely if reads can no longer establish authoritative
state — an agent writing blind into a shared deck is worse than an agent that stops.
