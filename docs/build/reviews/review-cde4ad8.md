> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review cde4ad8 (cs/hd) — Hedera rail, buyer signer, spend log, agent

Reviewer: cs-w1. Result: **blockers=1 should-fix=3**. Test: `packages/rail/src/hedera/test/w1-attacks.test.ts` on `cs/w1`; the 24 existing hedera tests pass, the new one fails.

## Blocker
**B5. A replayed payment can be delivered a second time.** `settle()` falls back to `confirmOnChain` whenever the facilitator fails. For a replay, the facilitator refuses the duplicate transaction id, but the mirror node shows the original `SUCCESS` with the exact net amounts, so the tiebreaker returns `success: true`. The in-memory `settled` set is the only guard, and it is empty after a hub restart, on a second hub instance, and it is checked before `settle` finishes (two parallel calls with one payment both pass `check`). The note says "a replay gets no delivery" because the chain refuses a second submission; the chain does refuse it, but `confirmOnChain` reads that refusal as proof of payment. Test `W1 B5` settles once, then settles the same payment on a fresh rail whose facilitator answers "duplicate_transaction" and whose mirror knows the original: expected `success:false`, got `true`. The window is the payment's validity (at most 180 s). Fix: keep the used transaction ids in the hub's store (persistent, keyed on the transaction id, insert-before-deliver, atomic), or have `confirmOnChain` succeed only if the id was never consumed; mark the id consumed before the facilitator call so parallel calls serialise.

## Should-fix
1. **Concurrent buys overspend the envelope.** `agent.buy` checks the cap against `spent` and records the spend only after a 200, so two parallel `buy()` calls both pass `checkEnvelope` before either records. Reserve the amount before signing and release it on failure.
2. **No hub-side bound on the signed validity window.** `checkTransfer` only requires the payment not to be expired; a buyer-chosen duration up to the network maximum widens the B5 replay window. Cap `validDurationSeconds` at the rail's `maxTimeoutSeconds`.
3. **Fee payer comes from the hub's challenge.** The agent signs a transfer naming whatever `extra.feePayer` the 402 gives. It cannot redirect value (payee, token and amount are checked against the listing), but a hostile hub can name an unreachable fee payer and park the agent's signed payment indefinitely until it expires. Acceptable for the demo; pin the facilitator set in the agent.

## Attacked, held
- Challenge vs listing: the agent refuses a different offerHash, amount or payee before the envelope, and refuses an amount that needs a human (never signs on its own authority). This is what the generic buyer lacked (B4).
- `checkTransfer`: exactly two entries on one token, no HBAR, no NFTs, payee and amount exact, payer distinct from fee payer and payee, signed, unexpired, memo bound to the offer.
- Facilitator answers that name another transaction id are rejected.
- `assertSignable`: asset allowlist, strict amount regex, account-id format, optional per-payment ceiling.
