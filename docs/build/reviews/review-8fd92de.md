> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review 8fd92de (cs/cs-20, cs-20b, #94): the router after my three should-fixes

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

1. **Health is keyed by offer and rail.**
   - `recordFailure(offerHash, railId)` writes only that offer's record, and the 402 for an offer reads only its own record.
   - One seller's misconfigured offer, or one buyer's near-expiry signature, can no longer reorder anyone else's 402.
   - A success resets only that rail on that offer.
   - `/healthz` reports a count of degraded offers per rail.
2. **Attempts are bounded.** 20 are kept per key, 5 go on a slip (`slice(-SLIP_ATTEMPT_LIMIT)`), and idle keys are evicted after 10 minutes.
3. **Protected rails come first.**
   - Escrow ranks before direct and batched rails unless the buyer opts in, with `X-Countersign-Allow-Unprotected: 1` or an `X-Countersign-Rails` naming one.
   - Nothing is dropped, so Gateway-only and Hedera buyers still pay.
   - The route reason says when a cheaper unprotected rail was passed over.
