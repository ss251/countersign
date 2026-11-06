> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 5a9c00b (cs/hd-13b, the project lead's item 4): held Hedera payments by default, B21 corrective

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

My `packages/rail/src/hedera/test/w1-held.test.ts` (cs/w1 5c24dac) is byte-identical on this branch and passes. The Hedera rail, Hedera buyer, runner and hub held tests give 237 pass and 0 fail.

## B21: closed, by two guards
- **verify** requires the payload's `createTxId` to be this schedule's own successful SCHEDULECREATE (`entity_id === scheduleId`); otherwise `create_mismatch`.
- **release** requires the held schedule's own `executed_timestamp` to equal the execution record's consensus timestamp. An old transfer can no longer stand in for a schedule that never ran.

## Closed from a3608ce
- **The failed-delivery sentence** now says exactly what is true: "Not delivered. This hub will not submit the seller's countersignature. Your USDC stays in your account unless the seller signs the schedule itself before it expires."
- **`refund` and `cancel`** succeed only once the schedule is expired or deleted; `still_signable` otherwise.
- **`verify` refuses an admin key.**
- **The hub never stores the countersignature bytes.**

## Closed from 787ecd9
- **`getTransaction`** prefers a SUCCESS record when the mirror lists several.

## Held (hd-13)
- **Runner, `daemon.ts`:**
  - It countersigns only a `hedera-scheduled` order.
  - It does so only after the output passes the offer's schema and the slip is signed.
  - Without a countersigner or a schedule it answers `fail`.
- **`prepareCountersign`** runs the seller's full pre-sign check, then signs a ScheduleSign it never submits.
- **Agent:**
  - It pays held by default.
  - The schedule entry is logged at create.
  - A failure keeps the hold reserved until `releaseExpired`.
  - The settlement must name its own create.
- **Live on testnet:** the reported held purchase executed with exactly -30000 from the agent and +30000 to the seller, and a failed delivery submitted nothing.

## Should-fix
1. **The countersigner checks the schedule against the hub's order, not the seller's own offer.**
   - `scripts/hedera/mcp-seller.ts` requires `order.payTo` to be the seller's account. But it passes `order.amount`, `order.asset` and `order.buyer` as the expected values, and the hub writes all three.
   - A hostile hub can dispatch a held order whose schedule pays 1 unit for an offer priced at 30000. The seller does the work, the schedule matches the order, and the seller countersigns a payment of 1.
   - This branch has no runner terms gate: cs-24's `funding.ts` is not in its base. Even after cs-24 lands, `startRunner` without a `funding` config skips it.
   - Fix:
     - Build the expected values from the served offer: amount = `offer.price`, payee = `offer.payTo["hedera-scheduled"]`, asset = Hedera testnet USDC.
     - Or have the daemon run the terms gate for every `hedera-scheduled` order regardless of config.
     - And pass `funding` in `mcp-seller.ts` once cs-24 merges.
