> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 9240aec (PR 164, raj/98-escrow-v2): the escrow v2 contract, before any deploy

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**, plus the project lead's open call on forced defaults (not repeated as a finding).

forge gives 80 pass and 0 fail on 9240aec. That covers the six acceptance cases, the 18 audit-fix tests (C1, C2, H1, L1, L2, M1), the bond paths, the v1 refusals, the TypeScript jobId vectors, and my `W1Bond.t.sol` (B16 and the deploy gate).

## Held
- **Conservation, on every exit:**
  - `_pay` sends `amount - toll` to the payee, accrues the toll, and moves the bond back to the payee's free bond.
  - `_refund` sends `amount` (plus `bond` when forfeited) to the buyer, or returns the bond.
  - `failDelivery` sends `amount + bond` to the buyer.
  - `sweepToll` moves `tollAccrued` to the treasury.
  - Each path zeroes the job's bond once, and every exit sets a terminal status before any transfer.
- **Time (L3), with disjoint windows:**
  - A dispute after delivery is allowed while `now <= endsAt`; `releaseAfterWindow` needs `now > endsAt`.
  - A dispute before delivery and a payee cancel of a Funded job are allowed while `now <= deadline`.
  - `release` and `failDelivery` are allowed while `now <= settleBy` (H1: deadline + 600); `refund` needs `now > settleBy`.
  - A Delivered job is never refunded by the deadline.
- **C1.**
  - A non-zero bond or window funds only when it matches `termsOf[payee][offerHash]` exactly (bond, window, price) and `deadline >= now + minDuration`.
  - Unregistered terms revert, and only the payee writes its own terms.
  - Changing the terms affects later jobs only: each job keeps its bond in `_jobBond` and its window in `_reviews`.
  - `bond <= price` and `window <= 86400` are enforced at `setTerms`.
- **C2 economics, as decided:**
  - A default after `settleBy`, a dispute inside the window, and `failDelivery` pay `amount + bond`.
  - A dispute before delivery and a payee cancel by the deadline return the bond.
  - A late cancel of an undelivered job reverts.
- **M1.** Bond and window are inside the jobId (the buyer's token nonce), so a front-run `fund` on other terms fails, and one on the same terms is harmless.
- **Signatures.**
  - Countersign, Release, Cancel, Accept and Dispute have distinct typehashes under the escrow's own domain, which includes the chain id and this contract's address.
  - Accept binds the delivered `slipHash`.
  - OpenZeppelin's `tryRecover` and `SignatureChecker` refuse high-s signatures.
  - A bond-deposit nonce can never equal a jobId (B16).
- **Reentrancy.** Every external function that moves tokens is `nonReentrant`, and state is written before the token is called.

## Should-fix
1. **`minDuration` decides whether the seller can be forced to default, and nothing guides the value.**
   - `setTerms` accepts any `minDuration`, including 0. The runner's `bond terms` requires the flag but accepts 0.
   - With 0, a buyer can fund a job whose deadline is seconds away, and the default after `settleBy` takes `amount + bond`.
   - Set it too high and every honest purchase reverts. A hub job's deadline is the buyer's clock when the buy starts plus the offer's deadline (`payer.ts`: `deadline: ctx.now + extra.deadlineSeconds`), while `fund` checks it against the block time plus `minDuration`. The gap covers any approval wait (up to 120 s), the hub's checks and mining, so a seller who registers `minDuration = offer.deadline` sees every hub purchase revert with `TermsMismatch`.
   - Fix, in the runner: default `--min-duration` to `offer.deadline - 300` and refuse anything under 60. Say both in the seller guide. The contract can stay as it is.

## The project lead's open call (my 14:45Z NEEDS-PROJECT-LEAD)
- **Forced defaults.** With `fund` open, a buyer can fund a bonded job directly on the escrow that the seller never receives, and take `amount + bond` after `settleBy`. The contract already lets the payee `cancel` until the deadline. Whichever option the project lead picks, this contract supports it without change only under option (a): runners cancel jobs they will not deliver.

## Notes
- **A bonded offer with window 0 protects the buyer against nothing.** The payee can `release` with its own signature without the hub's gate, as in v1, and is paid at once. Buyer recourse exists only on windowed offers. Say so where bonds are advertised.
- **A token-blocklisted payee freezes a Delivered job.** `accept` and `releaseAfterWindow` revert, and after `endsAt` only the payee's `cancel` frees the money. This predates v2 and applies to the same token-blocklist cases as v1.
- **My `W1Attacks.t.sol` was not ported to v2.** It still derives the v1 jobId. Its ground is covered here by the v2 suites: double release and refund, the settle-window edges, nonce replay, reentrancy and the slip-bound release signature.
