> Source: Grok 4.7 at xhigh, through its CLI, 06 Nov 2026, about 22:00 IST. This audit of escrow v2 (PR #164) is independent of the Pashov run.

I'll audit the escrow v2 branch against the prior findings, starting with the contract, interface, tests, and spec.Not safe to deploy. C1, C2, H1, and M1 are fixed on their original traces, but an online seller can keep a bond the new rules say they forfeit, and the arbiter can still lock that bond onto a buyer the payee never accepted.

**C1 — FIXED.** A non-zero bond or window funds only when `cs.bond`, `cs.reviewWindow`, `cs.amount`, and `cs.deadline` match `termsOf[payee][offerHash]`, which only that payee writes (`fund` 94–110, `setTerms` 128–136). `bond > price` reverts (132). The old path — unregistered offer, arbitrary bond — reverts `TermsMismatch`.

**C2 — FIXED.** `refund` (246–254) calls `_refund(..., forfeit=true)` (418), so after `settleBy` the buyer receives `amount + bond`. `cancel` on a Funded job after `deadline` reverts (268).

**H1 — FIXED.** `failDelivery` (275–280) and `release` (182–183) stay open while `block.timestamp <= deadline + 600` (`DISPUTE_WINDOW` 41, `_settleBy` 426–427). They revert only after `settleBy`.

**M1 — FIXED.** `bond` and `reviewWindow` sit in `COUNTERSIGN_TYPEHASH` (23–25) and in `jobId` (88–90, 314–317), which is the EIP-3009 nonce (362, 384). Any other bond or window is `CountersignatureMismatch` before the pull. `fundBonded` is gone.

**Lock.** Only `fund`, only when `cs.bond != 0`, only `msg.sender == arbiter` (103–110). The buyer must have signed EIP-3009 over that `jobId`. The payee signs nothing per job: earlier `setTerms` plus a free `depositBond` is enough. `jobId` commits bond and window; `_jobBond` and `_reviews.window` are copied from those signed values.

**Bond on the way out.** `release` (window 0), `accept`, and `releaseAfterWindow` return it to the payee (`_pay` 396–400). `cancel` returns it (271). `dispute` while Funded returns it (229–231); `dispute` while Delivered pays the buyer (232–235). `refund` and `failDelivery` (288) pay the buyer. Status is written before the transfer, and every closer is `nonReentrant`, so a job is not paid twice. After `settleBy` a Funded job closes only by `refund`. A Delivered job closes by `accept`, `dispute`, `cancel`, or permissionless `releaseAfterWindow`. Neither sits forever.

**Time.** Inclusive: Funded `cancel`/`dispute` through `deadline` (231, 268); `release`/`failDelivery` through `settleBy` (183, 280); Delivered `dispute` through `endsAt = deliveredAt + window` (234). Exclusive: `refund` at `now > settleBy` (250); `releaseAfterWindow` at `now > endsAt` (214). At the boundary the inclusive call succeeds and the exclusive call reverts. From `deadline + 1` through `settleBy`, a Funded job cannot be cancelled, disputed, or refunded.

**Replay.** `Accept(jobId, slipHash)` (28, 203) and `Dispute(jobId)` (29, 226) both bind `jobId`, and the EIP-712 domain binds chain and contract, so neither replays onto another job. `Accept` also binds the delivered slip and runs only in `Delivered`.

### High — the arbiter locks a bond the payee did not accept for that buyer

`fund` 103–110 and `failDelivery` 275–288. The v2 decisions say the arbiter’s only power is `failDelivery`. The code instead makes the arbiter the only caller who can lock a bond, with no payee signature over `(jobId, bond)` and no on-chain runner acceptance. `minDuration` may be 0, so `deadline = now + 1` matches (99–100). A cooperating buyer signs the registered price, bond, and window; the arbiter calls `fund`, then `failDelivery` while `now <= deadline`. The buyer is refunded `amount` and also receives the bond (`bond <= price`). The payee can `cancel` in between only by winning that race.

Fix: remove the arbiter check on `fund`, and require a payee EIP-712 `Lock(jobId)` before debiting `bondOf`. Leave `failDelivery` as the arbiter’s only mutator.

### High — an online seller keeps the bond

`cancel` (258–271) returns the bond on any Delivered job. `dispute` (232–235) forfeits only if it is mined first. `release` (179–196) on a windowed job is allowed until `settleBy`, past `deadline`.

The seller `release`s, the buyer submits `dispute`, and the seller `cancel`s in front of it. The buyer gets `amount` only. The same seller, after missing `deadline`, `release`s with any `slipHash` before `settleBy`, leaves `Funded`, and `cancel`s, so `refund` never forfeits. On a window-0 offer that grace `release` pays the seller `amount - toll` directly (189–190), and the buyer can no longer dispute (231).

Fix: on Delivered, make `cancel` revert or forfeit. If `deliveredAt > deadline`, a later `cancel` must forfeit.

### Medium — one Dispute signature has two bond outcomes

`Dispute(jobId)` (29, 226) returns the bond while Funded and forfeits it after `release`. A signature handed to a relayer to unwind a Funded job seizes the bond if mined after delivery.

Fix: sign `Dispute(bytes32 jobId, uint8 status)`, or `DisputeDelivery(bytes32 jobId, bytes32 slipHash)`, and require the signed status to match.

### Low — zero bond and zero window skip the registry

`fund` 94 lets a buyer open an unbonded job at any price on an offer the payee registered as bonded. The bond stays put. A runner that does not read `bondOfJob` works with no bond. If `termsOf[payee][offerHash].price != 0`, require a full terms match anyway.

No path pays the buyer more than `amount + bond`, or the payee more than `amount - toll` plus its own bond back. The arbiter receives nothing.
