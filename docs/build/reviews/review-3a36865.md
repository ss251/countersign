> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 3a36865 — escrow rail (packages/rail/src/escrow, rail.ts)

Reviewer: cs-w1. Result: **blockers=1 should-fix=3**. Test: `packages/rail/test/w1-attacks.test.ts` on `cs/w1` (commit after fb5fef1); the honest-deadline case passes, the shortened-deadline case fails.

## Blocker
**B3. The buyer can shorten the seller's delivery window.** `verify` accepts any signed `deadline` with `deadline > now+10` and `|deadline - (now + offer.deadline)| <= deadlineSlack` (default 120). The offer's `deadline` is "seconds the seller has to deliver". For a 120 s offer the buyer countersigns `now+11`; verify returns valid, the escrow funds with an 11 s window, and anyone refunds after that. If the output reaches the buyer before `release` (the seller must deliver, then sign), the buyer keeps the work and takes the money back. Test: `W1 B3: ... a deadline 100 seconds shorter than the offer promises is refused` expects `isValid=false`, gets true. Fix: one-sided, small skew. Require `deadline >= now + offer.deadline - 15` (and keep an upper bound); drop the shared 120 s slack. Also have the hub hold the output until `release` lands, or document that it does.

## Should-fix
1. **`submit()` can throw.** `pub.waitForTransactionReceipt` has no timeout or catch. A slow chain makes `settle` throw after `fund` was broadcast; the hub sees an error for a job that may be funded. Return `{success:false, errorReason:"pending", transaction: hash}` and let the caller poll `status(jobId)`.
2. **No spend guard on the Whitechain path.** The escrow rail sends from its own `submitter` with no fee cap, no allowlist, no hourly WBT ceiling or balance floor. Those live in `packages/relay` `Relayer` and the plan promises the ceiling on 1874. When wc-02 wires `whitechain` through this rail it must go through `Relayer`, or the ceiling is not real. Re-check at wc-02's REVIEW-REQ.
3. **Hub-paid gas on Arc is unmetered.** Any holder of a valid countersignature and balance makes the hub pay `fund` gas; mint many buyers and it drains. Add a per-buyer and global rate limit at the hub.

## Attacked, held
- Moved price: `t.amount !== req.amount` refused off chain; the chain refuses too (existing anvil test). Offer hash, payee, signature, nonce state, job status and buyer balance are all checked before send.
- Replay and domain: `checkCountersign` rebuilds the typed data with the configured chainId, escrow and token domain; the recovered signer must equal the buyer. A used nonce or existing job is refused (`used || status != 0`).
- Payee lock: `payTo` comes from the offer's per-rail map; the countersigned payee must equal it.
- Decimals: `priceInToken` scales from 6 and refuses fewer than 6 decimals.
- Single sender queue: nonces cannot collide.
