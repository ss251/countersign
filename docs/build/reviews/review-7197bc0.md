> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 7197bc0 (PR 100, #30): threat model, seller and buyer guides, interop doc

Reviewer: cs-w1, money-path claims only. Result: **blockers=0 should-fix=2**. This PR changes docs only.

I checked these claims against cs/int:
- A held call clears only with `--approve`. Hub approvals are not on cs/int.
- The countersignature binds offer, payee, amount, deadline, chain and escrow through the jobId.
- Refunds return budget only when `jobOf` on chain says refunded.
- Release needs only the payee's signature.
- `cancel` exists for the payee.
- Payments cannot be reused across calls.
- The output schema is checked before release.
- Gas is paid by the relayer, the relay, the facilitator or Circle.

All of these hold.

## Should-fix
1. **"Withhold service ... funded escrow jobs then refund after the deadline" is true only before release.**
   - The hub releases the escrow before it returns the output and slip to the buyer (`paidCall`: settle, dispatch, check, release, respond). A hub, alone or with a seller, can therefore release against the seller's real slip and then withhold the output or hand the buyer a tampered slip.
   - The seller is paid and nothing is refunded. In that case the buyer guide's line "A slip that fails is journalled as `bad-slip`. On escrow rails the money returns at the deadline" is wrong.
   - Fix: say that once the hub has released, the money is the seller's, and the buyer's evidence is the `Released` event carrying the slip hash. Tell the buyer to check `jobOf` (funded or released) before expecting a refund.
   - The same wording is in the buyer's `bad-slip` message in `packages/buyer/src/buy.ts` on cs/int, which is orch-cs's code; flagged there too.
2. **The Arc relayer section lists no limits, because there are none.**
   - The Whitechain relay has an allowlist, simulate-first, a fee cap, an hourly ceiling and a balance floor. The hub's Arc relayer has none of these.
   - A seller that lists an offer at the smallest price and buys it from a second wallet makes the hub pay `fund` and `release` gas on every call, at almost no cost to itself.
   - Say so under "Relayers and gas keys", or add the ceiling. The eip3009 rail in review (cs-15) adds a third transaction type on the same key.

## Held
- **Honest limits, stated plainly:**
  - collusion to release;
  - junk that passes the schema;
  - wash trading;
  - an excused dropped connection;
  - a declared but uncollected bond;
  - a blocklisted token;
  - the agent key spending up to the envelope;
  - remote approval and the bond, marked "decided, not built".
