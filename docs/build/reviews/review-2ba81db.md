> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Re-review 2ba81db (cs/cs-14c, #53): the OpenAI endpoint after B18, B19 and B20

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

My `packages/buyer/test/w1-openai.test.ts` (cs/w1 e424cb6) is byte-identical on this branch and passes. `packages/buyer` gives 147 pass and 0 fail.

## B18: closed
`currentEnvelope` reads the envelope from state on every completion, and falls back to the startup copy only when none is saved. A revoke, a lower cap or a narrower allowlist applies to the next completion.

## B19: closed
- `model` must be a 32-byte hash.
- In the fallback, the hub's listing must carry exactly that hash, or the answer is 404.
- `buy()` is called with `offerHash: model`, so the offer it fetches must hash to what the client named.

## B20: closed
- **After signing:** once `buy()` has signed (a `signed` or `failed` journal entry with a jobId), every failure answers 409 `payment_signed` with that jobId and `x-should-retry: false`. The official client retries a 409 by default; that header is what stops it. The message points to `resume`.
- **Duplicates:** identical bodies in flight share one purchase. A retry (`x-stainless-retry-count`) gets the stored answer back within the TTL.
- **Timeouts:** completions run with `idleTimeout` 255 and `server.timeout(req, 0)`, so Bun no longer cuts a slow seller at 10 s.
- **Classification:** failures are classified by where `buy()` stopped, using the journal, not the hub's wording. That closes the should-fix.

## Notes
- **The journal slice is shared.** `buyFailure` reads the journal entries added since this completion started. With two different completions running at once, it can report the other completion's jobId. The outcome is still safe, a non-retryable 409, but filter the entries by this buy's offer hash or reservation id.
- **Next step:** the one live Arc call, then the merge, as planned.
