> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 25e508b (cs/hd-08b, #41): scheduled checkout, the B11 corrective

Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. `packages/rail/src/hedera/test/w1-schedule.test.ts` is byte-identical to cs/w1's copy and passes. The Hedera rail and buyer tests give 96 pass and 0 fail on 25e508b.

## B11: closed
The seller now:
1. decodes the mirror's bytes with the generated `SchedulableTransactionBody` decoder;
2. requires the re-encoding to equal the input byte for byte;
3. accepts only the top-level fields {transactionFee, memo, cryptoTransfer, empty maxCustomFees}, with `data === "cryptoTransfer"`.

Every way to hide a second operation is refused:
- a repeated member, because the re-encode keeps only the last and no longer equals the input;
- a second oneof member, because its key is outside the allow-list;
- an unknown field at any depth, because protobufjs drops it and the re-encode differs;
- a non-minimal varint, because the encoding is not canonical.

Allowance debits (`isApproval`) throw. The `ScheduleInfoQuery` fallback is gone, so the seller never signs a body it could not read.

## Should-fix
1. **A release at the expiry boundary trusts a mirror that lags consensus.**
   - The problem:
     - `releaseExpired` releases as soon as the agent's clock passes `expiration_time` and the mirror shows no `executed_timestamp`.
     - A seller's sign that reaches consensus just before expiry appears on the mirror seconds later. In that window the agent releases the hold and logs `expired`, although the transfer ran.
     - `spentFromLog` then skips any later `spend` for that schedule, because `scheduled.has(schedule)` still holds after the release. The envelope undercounts by the schedule's amount, permanently.
   - The fix:
     - Release only once `now >= expiration_time + 60` and the mirror still shows no execution.
     - In `spentFromLog`, a `spend` for a schedule already released should add its amount back, counted once.
2. **The seller's check ignores `wait_for_expiry` and the schedule's payer.**
   - `countersignSchedule` promises that "the transfer runs the moment both keys have signed". That holds only when `wait_for_expiry` is false, and the honest buyer sets it false, but nothing refuses a schedule that sets it true.
   - With `wait_for_expiry` true, the seller's sign succeeds and nothing moves until expiry. The buyer can empty the account in between. The demo script waits for execution, so it is safe; a seller that delivers on a successful countersign would deliver unpaid.
   - `payer_account_id` is not checked either, so a buyer can make the seller the fee payer of the scheduled transfer.
   - The fix: refuse `waitForExpiry`, and refuse a payer other than the expected buyer. Document that a seller delivers only after `waitForScheduledExecution`.

## Held
- **SF1 (the earlier should-fix):**
  - `schedule()` checks the envelope and reserves before the create, in one JavaScript turn, so parallel schedules serialise.
  - If the create throws, the hold stays, because the create may have reached consensus.
  - A `schedule` entry is logged at create.
  - `releaseExpired` releases only when the mirror shows expired or deleted, and only once.
  - `spentFromLog` counts a schedule at create and does not count its spend twice.
  - Reconcile backs a schedule by its executed record, checking the payee credit, the agent debit and the memo.
- **SF2:** allowance transfers are refused.
- **SF3:** the operator pays the associations.
- **The strict shape:** one token, which is not HBAR; exactly one debit, the buyer's; exactly one credit, to the payee, for the offer amount; the offer memo; no HBAR or NFT entries; and the schedule must still be pending.
- **Payer and expiry on the buyer's side:** the buyer's own builder sets itself as payer and `waitForExpiry(false)`.
