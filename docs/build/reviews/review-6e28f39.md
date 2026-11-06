> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 6e28f39 (PR 61, TheRealRajdeep) — seller ratings and hub stats from verified slips
Reviewer: cs-w1. Result: **blockers=0 should-fix=3**. `bun test apps/hub` green. No dependency, script or lockfile changes in the diff; only `apps/hub` files.

## Held
- A job counts as delivered only if the hub's stored slip hashes to its own body, names this job, offer, buyer, seller and amount, and its Release signature recovers to the offer's seller. Unverified closed jobs are counted separately and score nothing. Failed and refunded jobs count against the seller; open jobs count for nothing; a buyer that is the seller (or the slip's payee) counts for nothing.
- Nothing is self-reported: every number is read from the hub's own `jobs`, `offers` and `slips` tables, read-only. Amounts are bigint atomic strings; the join cannot attribute a job to the wrong seller (seller comes from the offer row, case-insensitive match).
- The new routes write nothing.

## Should-fix
1. **`/ratings`, `/ratings/:seller` and `/stats` are unauthenticated and O(all jobs) per request.** `ratingJobs()` loads and JSON-parses every stored slip and each request re-walks the table (the signer cache only skips recovery). Fine now; at demo load a loop of requests burns the hub. Cache the result for a few seconds, or compute from a summary table.
2. **Wash trading is not excluded.** `selfDealt` catches buyer == seller or == slip payee only. A seller funding a second wallet to buy its own offer raises `delivered`, `buyers` and `volume` at the price of the toll and gas. That is inherent without identity, so say so in the docs next to the ratings, or weight by distinct buyers (the `buyers` field is there for it).
3. **A failed or refunded job always counts against the seller, whoever caused it.** A hub crash, a slow runner or a hostile input inside the schema lowers the score at no cost to the buyer. Consider counting only failures after the runner accepted the job, or showing failed and refunded separately in the UI (they are separate fields already).
