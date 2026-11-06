> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 82ccb68 (PR 126, cs/wc, closes #14): pending paywall claims, refund reasons, whole-or-nothing cancels

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## Held
- **Whole or nothing.** The merchant service refuses any `amount` other than the full one on a held or in-review escrow (`partial_cancel_not_possible`, 400) before it signs a cancel. That closes my should-fix on #83 and #114. Leaving `amount` out still means the whole cancel, and the desk always sends it.
- **Pending claims.**
  - A settle that answers `settlement_pending` keeps its authorization claimed until `validBefore + 60`. A retry with the same authorization gets 409 "still settling" and is never submitted twice.
  - Any other failure releases the claim at once.
  - Eviction never drops a pending claim.
- **Reasons.** They are validated against the fixed set at the merchant service and on both relay routes, stored with the refund or the job's close, and have no effect on amounts.
- **Migrations.** `ALTER TABLE` runs only when the column is missing.

## Should-fix
1. **A pending payment that lands is never served.**
   - A pending claim never becomes settled. A buyer who retries with the same authorization after the transaction has landed still gets 409 until `validBefore + 60`, and after that a refusal, because the token has used the authorization.
   - The buyer paid and gets nothing. A client that retries with a fresh authorization pays twice.
   - Fix: on a retry against a pending claim, read the stored `txHash` receipt. If it succeeded with the expected transfer, mark the claim settled and serve the content.
