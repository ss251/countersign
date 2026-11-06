> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review f580e45 (cs/hd) — Hedera agent guards: envelope reservation and trusted fee payers
Result: **blockers=0 should-fix=3**. Hedera agent tests pass.
Held: the check and the reservation share one JavaScript turn, so parallel `buy()` calls serialise against `spent + reservations`; a signing failure releases the reservation; the fee payer must be one the agent read from the hosted facilitators, never the hub's word alone.
Should-fix:
1. **`charged()` gives up after about 12 s, and a "no" releases the reservation.** The mirror node trails consensus, so a payment that lands late is neither counted nor reserved, and the cap can be exceeded. When the answer is unknown, keep the reservation (safe direction) and let the HCS log reconcile it.
2. **An empty trusted set is cached forever.** If every facilitator is unreachable at the first buy, `trusted` becomes an empty set and the agent refuses every fee payer until restart. Cache only a non-empty result.
3. **The reservation leaks on the mismatched-id throw.** When the hub reports a settlement id other than the one the agent signed, the function throws without settling or releasing. Safe direction, but the budget shrinks for the life of the process; settle or release it in a `finally`.
