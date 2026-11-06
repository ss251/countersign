> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 2321bd7 (PR 165, cs/hd-14, closes #163): the verifier checks a held Hedera slip

Reviewer: cs-w1. Result: **blockers=1 should-fix=0**.

Test: `W1 B22` in `packages/verify/test/w1-verify-held.test.ts` on cs/w1. It runs against this branch, because the held route is not on cs/w1. On 2321bd7, `packages/verify` gives 27 pass and 1 fail (B22).

## Blocker
**B22. A held slip is proved paid by a payment that is not its job's.**
- A held slip's `payment` and `settlement` sit outside the seller-signed body. The body names the job: `jobId = keccak256(createTxId)`, as the hub sets it with `heldJobId`.
- `checkHeld` checks that the payment names a schedule and that `settlement.transaction` equals the payment's `createTxId`. It never checks that this `createTxId` is the body's job.
- The mirror proof then shows that the payment's schedule executed with the right buyer, payee and amount. It does not show that this slip's job was paid.
- So a slip for a job whose own schedule never executed (say, a failed or abandoned call the seller had already signed) verifies VALID when it carries the payment of another executed schedule between the same buyer and seller for the same amount, such as the buyer's earlier purchase.
- Ratings count slips that check out, and "a slip anyone can verify without us" is a product claim.
- The test: the body's jobId is that of an unpaid create; the payment and settlement name an executed schedule. Expected `valid: false`; got `true`.
- Fix, one line in `checkHeld`: refuse unless `slip.body.jobId === keccak256(toBytes(createTxId))`, the escrow-free equivalent of the countersignature binding Arc slips get.

## Held
- **Routing.** A slip takes the held route only when `accepted.network` is `hedera:*`, `accepted.extra.name` is `hedera-scheduled` and `body.rail` is `hedera-scheduled`. The body is seller-signed, so an Arc slip cannot be steered off its countersignature check.
- **The mirror proof (`--mirror`):**
  - `createTxId` must be a successful SCHEDULECREATE of exactly `scheduleId`, submitted by the slip's buyer.
  - The schedule must have executed.
  - Its execution record at that consensus time must net exactly `+amount` to `payTo` and `-amount` from the buyer, in the slip's asset.
  - Without `--mirror` the on-chain check is listed as skipped, as Arc's is without `--rpc`.
- **Arc countersign slips are unchanged.**
