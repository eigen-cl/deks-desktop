# Write recovery and transaction journal

## Journal each mutation

Before sending a write, retain:

- presentation ID and pre-write revision;
- semantic intent and exact command batch;
- unique idempotency key;
- expected resulting objects or changed states.

After success, retain the returned revision and transaction ID. Reuse an idempotency key only for the exact same request.

## Classify the response

- **Success with revision** — continue from the returned revision.
- **Validation failure** — fix the request; an atomic batch changed nothing.
- **Revision conflict** — re-read, reconcile concurrent work, then issue a new semantic transaction with a new key.
- **429, 5xx, timeout, disconnect, or malformed response** — the result is uncertain. Do not mutate again yet.

For an uncertain result:

1. Re-read `get_presentation`.
2. Compare the observed revision and state with the journal.
3. If the revision advanced and the intended state is present, treat the write as successful.
4. If the revision did not advance and the state is absent, retry the exact request with the original idempotency key.
5. If state is mixed, unrelated edits intervened, or the result remains ambiguous, reconcile from the fresh state and create a new transaction; do not guess.

For destructive operations, never auto-retry after an uncertain response. Re-read the exact target first.

## Recover a partial deck

Read ordered checkpoints, element identities, and transitions. Compare them with the storyboard and journal. Resume from the first missing coherent scene rather than rebuilding completed slides. Use `undo_transaction` only for a known transaction ID or the newest confirmed mistaken transaction.

Keep batches at or below 100 operations. After repeated 429/5xx responses, reduce batch size and stop if reads cannot establish authoritative state.

