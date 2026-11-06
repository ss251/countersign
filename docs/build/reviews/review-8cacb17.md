> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review 8cacb17 (PR 83, cs/wc, #32): merchant desk after B15

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. On 8cacb17 with `apps/web/test/w1-merchant.test.ts` (cs/w1 ec9347e) added, `w1-merchant` and `merchant` give 67 pass and 0 fail.

## B15: closed
- `refundOrder` now requires `amount`.
- The one-click path sends `BigInt(order.refundable)`, the figure the merchant confirmed. The service signs that or refuses.

## Fixed since 5aab25b
- **Should-fix 1:**
  - A pending or unknown refund is its own "unknown" state. It is never shown as refused, never offered again while the record is unchanged, and the partial form closes on it.
  - Undo after the timer has fired changes nothing.
- **Should-fix 3:** records for any merchant other than the ledger's are dropped from the sums and the export. A body without an orders list is an error, never "no payments yet".
- **Should-fix 4:** `refundPart` marks the row as sending and refuses while a one-click refund is in its undo window or in flight.

## Still open
1. **The service ignores `amount` on a held escrow and cancels the whole job.** This is `merchant-server.ts` in `packages/relay`, unchanged in this PR. A held job's refund should be the full amount or refused: refuse any `amount` that is not the job's full amount, so B15's rule, "the confirmed figure or a refusal", also holds on the held path.
