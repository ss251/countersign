> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 1f7615d (cs/wc, PR 17) — paywall, pay-fetch, reconcile, ledger changes since c5f7e22

Reviewer: cs-w1. Result: **blockers=2 should-fix=2**. Tests in `packages/relay/test/w1-attacks.test.ts` on `cs/w1`; both new tests fail on this sha, the earlier three pass.

## Blockers
**B9. One payment buys more than one response (paywall).** `whitechainPaywall` verifies, runs the handler, then settles. Verify only reads the token's nonce state, which is unchanged until the first settle lands. A second request carrying the same payment header, sent while the first handler is still running, also verifies; its handler runs; when it settles, `settleExact` finds the first request's payment in the ledger and answers `success:true` (idempotent by design), so the paywall serves it too. The merchant does N units of work for one payment, limited only by handler duration. Test `B9`: two requests 150 ms apart, handler 300 ms, relay with a token that refuses a used nonce: both get 200, expected one. Fix: claim the authorisation nonce in the paywall (an in-flight and settled set keyed on `from:nonce`) before `next()` and answer 402 or 409 to any second claim; and make the ledger's idempotent answer apply only to the request that owns the claim.
**B10. pay-fetch counts spend after observing success, not when it signs.** `spentAtomic` is only incremented when the retry returns a settle header. A hostile merchant takes the signed authorisation, answers 500, and settles the authorisation itself through the relay; the buyer sees no receipt, so no spend is counted, and it can repeat until the wallet is empty. The per-call limit bounds each one, the budget bounds nothing. `validBefore` is also `now + requirements.maxTimeoutSeconds`, a server-chosen number. Test `B10`: budget 0.05 with a 0.05 price against a merchant that always answers 500 hands out 5 authorisations; expected at most 1. Fix: reserve the amount before signing and release only when the chain shows the authorisation unused after `validBefore`; cap `validBefore` at about 5 minutes.

## Should-fix
1. **Serve-before-settle runs side effects without payment.** If the buyer's balance moves between verify and settle, the handler already ran. Fine for read-only endpoints; say so in the drop-in docs, or settle first for non-idempotent handlers.
2. **`pay-fetch` pays any merchant that asks.** There is no payee allowlist, only amount limits. For an agent this belongs in the envelope; at least document it.

## Not covered
`reconcile.ts` (only `TransactionReceiptNotFoundError` counts as absent; a used nonce confirms; delete only past `valid_before + 60`) reads correctly: a nonce that is used is never treated as unsettled. Ledger `description` and `closeKind` additions touch no money path.
