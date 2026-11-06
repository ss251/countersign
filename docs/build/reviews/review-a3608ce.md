> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review a3608ce (cs/hd-12, the project lead's item 4): the hedera-scheduled hold rail

Reviewer: cs-w1. Result: **blockers=1 should-fix=1**.

Test: `W1 B21` in `packages/rail/src/hedera/test/w1-held.test.ts` on cs/w1 (5c24dac). It runs against this branch, because `held.ts` is not on cs/w1. On a3608ce the Hedera rail tests give 112 pass and 1 fail (B21).

## Blocker
**B21. Release confirms the create transaction the payment named, not the schedule it held.**
- The payment carries `scheduleId` and, separately, `createTxId`. `verify` checks the schedule, but nothing checks that `createTxId` is that schedule's create transaction.
- `settle` keys the hold on `createTxId`, and `release` confirms payment with `waitForScheduledExecution(hold.createTxId)`, the execution record of the transaction the payment named.
- The attack:
  1. A buyer who once paid this seller the same amount through another schedule (on another hub, or outside countersign) names that old create transaction with a new schedule. The old id is not a job on this hub, so the jobs table does not refuse it.
  2. The seller delivers and countersigns the new schedule.
  3. The buyer has emptied its account, so the new schedule's transfer fails. The ScheduleSign itself still lands.
  4. Release finds the old SUCCESS record with the right payer, payee and amount, and reports the seller paid. The hub hands over the output, and the seller got nothing.
- The test: a pending schedule that never executes, plus a payment naming an old create transaction whose execution was a matching transfer. Expected: release reports nothing paid. Got: success.
- Fix, either or both:
  - In `verify`, look up `createTxId` and require a successful SCHEDULECREATE whose `entity_id` is `scheduleId`.
  - In `release`, confirm the held schedule itself: `executed_timestamp` set, and the executed transfer moving exactly the amount.

## Should-fix
1. **"Nothing was charged ... no money moves" is not guaranteed while the schedule can still be signed.**
   - On a failed delivery, the hub tells the buyer the scheduled payment "was never countersigned, so it expires unsigned".
   - In fact the runner has already returned payee-signed ScheduleSign bytes, which the hub holds and anyone holding them could submit within their valid window. And the seller can sign afresh with its own key at any time before expiry, which is at least 60 s after the job's deadline.
   - `escrow.refund` and `escrow.cancel` drop the hold and report success while the schedule is still pending.
   - Fix:
     - Say exactly what is true: the money stays in the buyer's account unless the seller signs the schedule before its expiry time, and this hub will not submit the seller's signature.
     - Discard the held ScheduleSign bytes on a gate failure.
     - Report a refund only once the schedule is expired or deleted, as `status()` already does.

## Answers to your questions
- **"The seller can still sign alone."** That matches the v1 escrow, where the payee's own release needs no hub. The hold protects against a seller that never delivers or fails honestly, not a malicious one. "Protected" in the router is right on that footing, but say it next to the label.
- **Holds live in memory.** That is acceptable. After a restart the release has no hold and fails, the buyer gets no output, and the schedule expires unless the seller signs it.
- **A buyer who sets an admin key** can delete the schedule after delivery. Release then fails and the output is withheld, so the seller's work is wasted but nothing is stolen. Consider refusing schedules that carry an `admin_key` in `verify`.
- **The four `apps/web` map edits** are display-only.

## Held
- **Verify:**
  - The schedule must be pending, not deleted or executed, without wait-for-expiry, and expire between `maxTimeout + 60` and 3600 s.
  - The body is decoded strictly with the exact terms (#41's checker): asset, amount, payee, offer memo, and the schedule's payer as the only debit.
  - The payee must have `receiver_sig_required`, so nothing moves without the payee.
  - The payer's key must be among the schedule's signatures.
  - A schedule id can be claimed only once.
- **Release:** it submits only a `ScheduleSignTransaction` for the held schedule, whose transaction id belongs to the payee. The hub holds no key.
