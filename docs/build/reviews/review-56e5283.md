> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 56e5283 (cs/hd, hd-08 scheduled checkout, #41)

Reviewer: cs-w1. Result: **blockers=1 should-fix=3**. Test: `packages/rail/src/hedera/test/w1-schedule.test.ts` on `cs/w1`; the honest-body case passes, the two crafted-body cases fail.

## Blocker
**B11. The seller's pre-sign check accepts bodies it does not fully read.** `countersignSchedule` approves a schedule on the strength of `inspectScheduled`, a hand-written protobuf reader that takes the first field-9 member and ignores everything else. A `SchedulableTransactionBody` carries one `data` oneof, and protobuf keeps the last member when a body names two. A body holding the benign USDC transfer first and a second data member (or a second transfer) after it passes the check; the network then executes the last one once the seller's key has signed. The seller's signature is the authority that matters here: it can approve operations on the seller's own account, not only the credit. Test `B11` builds the real benign body from the SDK, appends (a) a second data member (field 15) and (b) a second field 9: both are accepted, expected a refusal. I could not show whether the mirror node ever returns such bytes (it may re-serialise the parsed body), but the check is the seller's only line and it should not depend on that. Fix, as hd already suggests: decode with the generated `SchedulableTransactionBody` decoder and require exactly the transfer member; at minimum, refuse any repeated field and any field number outside {memo (2), transfer (9)} and any unknown field inside the transfer body.

## Should-fix
1. **No envelope reservation or log entry at create.** `createScheduledPayment` signs a transfer that the seller can execute at any time until expiry, but the spend is logged to HCS and counted only after execution (`scripts/hedera/schedule.ts`). A crash between create and log leaves a live, unlogged, unreserved authorisation, and two schedules created back to back both pass the cap. Reserve in the agent before `create.execute` (as the exact path does), log a `schedule` entry at create, and release only when the mirror shows the schedule expired or deleted.
2. **`is_approval` is ignored.** An allowance-based debit looks the same as a normal one. With the payer pinned this cannot move another account's money, but refuse it explicitly so the check says what it checks.
3. **Setup funding.** `scripts/hedera/setup.ts` seeds 0.3 HBAR where the association needs about 0.72; fund to cover it (hd already knows).

## Held
- The check itself, once a body is read, is strict: one token, exactly one debit and one credit, buyer debited, seller credited the offer amount, offer memo, no HBAR or NFT entries, and the schedule must still be pending (an executed or expired schedule is refused). An executed schedule is never reported as expired.
- The spend-log audit follows the scheduled child record (`?scheduled=true`) and backs both ids with one entry.
