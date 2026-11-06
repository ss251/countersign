> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review ba868fa (cs/cs-23) and 808e6e2 (cs/cs-25): escrow v2 wiring, flipper 3

Reviewer: cs-w1. Result: **blockers=0 for both, should-fix=2**. cs-23's hub and rail tests give 188 pass and 0 fail on ba868fa. cs-25's buyer, runner and core tests give 261 pass and 0 fail on 808e6e2.

## Held, on orch-cs's four points (cs-23)
1. **Accept and dispute.** `POST /jobs/:id/accept` and `POST /jobs/:id/dispute` recover the buyer's `Accept(jobId, slipHash)` or `Dispute(jobId)` under the escrow's domain, compare it to `job.buyer` and only then submit.
   - An accept needs `delivered` plus a stored slip hash.
   - A dispute needs `funded` up to and including the deadline, or `delivered` up to and including `endsAt`.
   - Jobs on rails without v2 operations get 409.
2. **v2 verify** refuses v1 terms, and any countersigned bond or window that is not the hub's own entry (the offer's), before any transaction. Funding uses the v2 struct.
3. **Timing.**
   - The janitor releases a delivered job only after `endsAt`, so the hub's own dispute route (which allows up to and including `endsAt`) never races it.
   - It refunds a funded v2 job only after `deadline + 600`.
   - `failOnGate` stops at `deadline + 600`.
4. **v1 paths unchanged.** v1 rails keep a zero window and the old refund timing.

## Held (cs-25)
- **Version pin:** taken from the agent's own pinned rail, never from the hub. A v2 pin requires `escrowVersion: 2`, and a v1 pin refuses a v2 402.
- **Bond and window:** they must equal the fetched, hash-checked offer's before the v2 struct is signed into the jobId.
- **`dispute --direct`:** the agent sends `dispute(jobId, "")` itself when the hub will not relay. This closes my should-fix on #130.
- **`bond terms`:** checks bond ≤ price and window ≤ 86400 locally before `setTerms`. `--show` reads `termsOf`.

## Should-fix
1. **A transient RPC error after a v2 delivery strands the seller's money until someone acts by hand (cs-23 `call.ts`).**
   - After a successful release with a window, `paidCall` awaits `escrow.reviewOf(jobId)` with no catch. If that read throws, `updateJob` to `delivered` and `endsAt` never runs. The buyer gets a 500 without the output, and the job stays `funded` in the store, though it is Delivered on chain.
   - The janitor then never calls `releaseAfterWindow` for it, and its deadline refund reverts.
   - Fix: record `delivered`, with `endsAt` taken from the countersigned window and the release receipt's block time, before any further read. Or catch the error and let the janitor re-read `reviewOf`.
2. **A bonded seller can be made to default (design; must close before bonds are advertised).**
   - The spec says the minimum duration means "the payee always has time to deliver or to cancel and keep its bond". That holds only if the payee knows about the job.
   - `fund` is open. A buyer can fund a job at the payee's registered terms directly on the escrow, never calling the hub. The runner never receives an order, nothing is delivered, and after `settleBy` the buyer calls `refund` and takes `amount + bond`. The cost is gas.
   - Through the hub, an input that passes the schema but makes the skill throw has the same effect: a runner error is not a gate failure, so it ends in a default.
   - The contract already lets the payee escape with `cancel` (bond returned) until the deadline. Nothing calls it.
   - Fix, no contract change: before bonds are advertised, the desktop runner and the phone cancel any bonded job they will not deliver:
     - on a refusal or a runner error;
     - for any `Funded` event naming them as payee that the hub has not dispatched within a short grace.
   - The alternative is a contract change: return the bond on a default the seller never acknowledged. That is the project lead's call, raised as NEEDS-PROJECT-LEAD.

## Notes
- **`review.ts` signs and submits under the hub rail's configured escrow, not the job's own.** v1 jobs fail safely (no v2 operations, or the signature or transaction fails), but reading the escrow from the job's own terms is exact.
- **Boundaries in the contract.** The hub keeps dispute (`now <= endsAt`) and release (`now > endsAt`) disjoint. The contract should do the same, per L3; confirm that in the contract review.
