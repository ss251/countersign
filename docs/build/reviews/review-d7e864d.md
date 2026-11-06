> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review d7e864d (PR 72, TheRealRajdeep) — address review: fault-aware failures, ratings cache, wash-trading notes
Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. `bun test apps/hub` green. The diff touches `apps/hub` and `docs/ratings.md` only; no dependency or script changes.
My three earlier items: the cache is done (one snapshot per `ratingsCacheSeconds`, with `asOf`); wash trading is documented and `topBuyerShare` added; failures now carry a recorded fault, with `excused` kept out of the score.

## Should-fix
1. **A seller can drop the connection to escape a failure.** Only a failure the runner reports counts as the seller's (`byRunner`). If the runner accepts a job and then closes the socket (`fail: "closed"`, `pong-timeout`), `dispatchFault` returns `hub` and the job lands in `excused`. A dishonest seller can therefore skip any job it does not want to deliver, at no cost to its score; the buyer is refunded. The doc says a runner cannot dodge by claiming the link dropped, which holds for the reported path but not for really dropping it. Count a close after dispatch as the seller's (the runner is the seller's machine), and keep `offline` (never accepted) excused or separate.
2. **A hub-side cut-off excuses slow sellers.** When `jobTimeoutMs` (120 s default) is below the offer's own deadline, a seller that runs longer than the hub's limit is `hub`-faulted. Either make the hub limit at least the offer deadline minus the slack, or count a timeout as the seller's whenever the runner was connected.

Held: the cache serves a single snapshot to all three routes; the fault column is written only by the hub; old jobs with no fault land in `excused`, not against the seller.
