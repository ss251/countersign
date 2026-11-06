> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review bb5f265 (cs/cs-20, #94): the rail router

Reviewer: cs-w1. Result: **blockers=0 should-fix=3**. Routing never moves money:
- Each 402 entry stays paired with its own rail, and amount and payee come from that rail's challenge.
- Matching the paid retry is a set lookup, so a reorder never breaks a match.
- The order verify, nonce check, settle, `claimJob` is unchanged.
- `slipCommitHash` is unchanged, and `route` sits outside the committed hash.

## Should-fix
1. **Per-offer and per-buyer events set hub-wide rail health.** `onChallengeFailure` calls `recordFailure(railId)` for the whole hub (`route.ts:228-231`), and a refused settle also counts.
   - **Trigger A, from any seller:** publish `rails: ["hedera"]` with no `payTo.hedera`, keep the runner online, and send two unpaid calls in 10 minutes. Each hedera challenge throws, and hedera is degraded for every offer.
   - **Trigger B, from any buyer:** sign a countersignature that expires one second after the hub's verify. The settle's re-verify refuses it, and escrow is demoted on that offer, or degraded hub-wide after two.
   - Nobody's money moves, but one party reorders every other offer's 402. The buyer SDK pays the first entry it can, so that party picks the rail.
   - Fix: key health by (rail, offer), or count only failures the rail itself owns: RPC, facilitator, submitter. Never count a challenge that throws on one offer's own configuration, or a settle refused for the buyer's own expired signature.
2. **The attempt log is bounded in time but not in count, and it is copied into the slip.**
   - Every unpaid call on an offer with a failing challenge adds a `challenge-failed` entry. `attemptsFor` returns the whole list, and the hub stores it in the slip.
   - Ten minutes of unpaid POSTs makes the next buyer's slip carry thousands of entries, and `prune` walks them on every request.
   - Fix: cap entries per key (say 20), and cap what goes into `settlement.route`.
3. **The cost ranking puts no-refund rails ahead of escrow, and the buyer takes whatever comes first.**
   - With the declared tolls, gateway and hedera outrank escrow whenever an offer lists them. The 402 no longer follows `offer.rails` order, and the buyer SDK pays the first entry it can (`buy.ts`).
   - Buyers therefore default to rails whose payment is final before delivery, with no refund.
   - Fix: the buyer's own policy should rank refundable rails first, and the router should count refundability in its cost.

## Notes
- **A rail that reports no payer files its attempts under `""`.** That is the same key as the offer-wide bucket, so the attempts appear twice on the slip, and a no-payer settle failure shows on other buyers' slips.
- **Buyer caps that exclude every rail return 503 `no-rail`** ("No settlement rail is configured"), which reports the buyer's own choice as a hub outage. Answer with a trace that says the buyer cannot pay.

## Held
- **Headers:**
  - Only `buyerCaps` reads them. Empty parts, unknown ids, 0, signs, decimals and values above 2^53 are ignored, and one bad id drops the whole header.
  - Caps only filter `offer.rails`, so a header can never add a rail.
- **Health:** a degraded or demoted rail is reordered, never removed. A payment signed for it still settles.
- **Policy:** `chooseRail` is pure, its comparator is a total order, and repeated rails are rejected at publish.
- **Bounds:** health has one entry per rail, recent decisions stop at 20, and settle failures are pruned after 600 s.
