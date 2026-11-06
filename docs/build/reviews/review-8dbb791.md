> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 8dbb791 (cs/cs-19, #93): the seller bond (escrow v2, part 1)

Reviewer: cs-w1. Result: **blockers=1 should-fix=3**, plus one **deploy gate**.

Tests are in `contracts/test/W1Bond.t.sol` on cs/w1 (f63f306):
- `test_W1_B16_...` fails.
- `test_W1_deploy_gate_...` fails.
- cs-19's own `Bond.t.sol` passes 14/14.
- `W1Attacks.t.sol` passes 10/10, updated for the four-argument constructor.

The firstmate's cross-model review of the combined contract diff still applies before the redeploy.

## Blocker
**B16. A buyer's countersignature can be spent as a bond deposit.**

The problem:
- The countersignature is an EIP-3009 `ReceiveWithAuthorization` naming this escrow, with nonce = jobId.
- `depositBond` accepts exactly that kind of authorization, from any caller, for any `payee`.
- So whoever holds a countersignature can call `depositBond(buyer, amount, validAfter, validBefore, jobId, v, r, s)`. That is the hub, or anyone who reads it from a pending `fund` transaction.
- The buyer's money leaves its wallet as `bondOf[buyer]`, the token burns the nonce, and the job can never be funded. The buyer's call fails, and its money sits in the escrow under a balance no buyer tool knows how to withdraw.
- Two contract functions with different meanings accept one signature. That is a domain-separation failure, and once deployed it cannot be fixed.

The test: a stranger replays a fresh countersignature into `depositBond`. Expected: nothing credited, and the same countersignature still funds its job. Actual: 1.5 USDC credited as the buyer's bond, and `fund` then reverts.

The fix, either of:
- `depositBond` requires `msg.sender == payee`. The runner already submits its own deposit (`packages/runner/src/bond.ts`). `Bond.t.sol` then needs `vm.prank(seller)`.
- Deposits use a bond-only nonce the escrow checks, `nonce == keccak256(abi.encode(BOND_DEPOSIT_TYPEHASH, payee, amount, salt))`, so no jobId can ever be a valid deposit nonce.

## Deploy gate: not a merge blocker, must pass before the one redeploy
**Anyone can lock a seller's whole free bond.**
- `fundBonded` is permissionless, and the caller picks `bond`. A stranger funds a job of their own, with themselves as buyer, the smallest amount and a ten-year deadline, and locks every unit of the seller's free bond in it.
- Every real bonded purchase then reverts with `BondMissing` until the seller notices and cancels.
- D11 makes `fundBonded` arbiter-only in #98. `test_W1_deploy_gate_a_stranger_cannot_lock_a_sellers_free_bond` must be green on the contract that is deployed.

## Should-fix
1. **The arbiter key now holds every seller's free bond (a decision, before the redeploy).**
   - With `failDelivery` and an arbiter-chosen `bond` (D11), a leaked hub relayer key plus any buyer address moves a seller's entire free bond in two transactions: fund a job of its own locking all of it, then fail it. In v1 that key could only refuse to submit.
   - Option (a): accept it, and say it in the threat model and the seller guide. The bond is only as safe as the hub's key, so keep it small.
   - Option (b): the seller signs each lock. The runner signs `LockBond(jobId, bond)` when it takes the job, and `failDelivery` can then slash only a bond the seller put on that job.
   - This is orch-cs's and the project lead's call. The contract is immutable after the redeploy.
2. **The buyer never gets back the budget of a failed delivery.**
   - `resume` appends `failed` with no reservation, so `journal.spend()` keeps counting it. Only an on-chain Refunded (3) returns budget.
   - `failDelivery` leaves the job Failed (4), with the amount and the bond already back at the buyer.
   - Fix: treat on-chain Failed like Refunded, checked on chain the same way.
3. **Nothing checks on chain that a job's locked bond is the offer's bond.**
   - The buyer refuses a 402 whose `extra.bond` differs from the offer's, but the hub alone picks the `bond` passed to `fundBonded`.
   - Fix: read `bondOfJob(jobId)`, or the `BondLocked` event, in the buyer after funding and in the slip verifier.

## Notes
- **The bond is not in the countersignature.** D11 records why: it would change the jobId.
- **The contract still sets no maximum deadline.** That predates this PR, but a bonded job now locks its bond until that deadline.

## Held
- **Conservation:** free bonds, locked bonds and funded amounts sum to the balance.
  - Each terminal path zeroes the job's bond exactly once.
  - Release, refund and cancel return it to the payee's free bond.
  - `failDelivery` pays `amount + bond` to the buyer, with no toll.
- **`failDelivery`:**
  - Only the arbiter may call it, only on a Funded job, and only before the deadline.
  - Release racing failDelivery is settled by status.
  - Every external mutator is `nonReentrant`, and status is set before any transfer.
- **`depositBond`:** it checks the exact balance delta and refuses a zero amount and the zero payee. A replayed deposit authorization credits nothing twice.
- **`withdrawBond`:** it reaches only the caller's free bond.
- **Compatibility:** `Failed` is appended to the status enum and `Released` is unchanged, so v1 slips still verify.
- **Hub:** `failOnGate` runs only on the hub's own gate: the output or slip check, or a slip hash that does not commit the body. Runner errors and timeouts keep the deadline refund, which returns the bond.
- **Rail:** it calls `fundBonded` only when the hub's own entry carries a bond above 0. A front-run plain `fund` makes `fundBonded` revert with `JobExists`, which is a failed settle, never a silently unbonded job.
- **Buyer:** it refuses a 402 whose bond differs from the offer's.
