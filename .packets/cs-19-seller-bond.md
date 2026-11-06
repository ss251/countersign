# cs-19-seller-bond — the declared bond becomes real: locked at funding, paid to the buyer when the delivery fails the gate (refs #93)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal (the captain's words)

"The offer already declares bond and nothing collects it. Make it real in the smallest honest way, a bond deposited with the escrow on funding and paid to the buyer when the seller fails to deliver by the deadline, with the buyer still able to take the normal refund path when the seller does deliver nothing at all. Write the test that proves a failing seller is worse off than a silent one."

| Case | Payment | Bond |
|---|---|---|
| **Delivering seller**: release by the deadline | to the seller, minus the toll | back to the seller's free bond |
| **Failing seller**: delivers by the deadline, but the delivery fails the hub's delivery gate, so the hub's arbiter calls `failDelivery` | back to the buyer, no toll | **to the buyer** |
| **Silent seller**: nothing is delivered; anyone calls `refund` after the deadline | back to the buyer | back to the seller's free bond |
| **Payee cancels early** (`cancel`) | back to the buyer | back to the seller's free bond |

Trust, stated honestly: the hub's delivery gate decides failure, and only the escrow's `arbiter` (the hub's relayer) may call `failDelivery`.

## Lease

You may create or change only these paths:

- **Contracts:**
  - `contracts/src/CountersignedEscrow.sol` and `contracts/src/ICountersignedEscrow.sol`
  - `contracts/test/CountersignedEscrow.t.sol` (existing tests may change only for the new constructor argument), `contracts/test/Bond.t.sol` (new) and `contracts/test/Parity.t.sol` (constructor only)
  - `contracts/script/Deploy.s.sol`, which takes the arbiter from the env var `ARBITER`
- **Rail:** `packages/rail/src/escrow/abi.ts` (regenerated from `forge build`; keep the exported name and the `as const` on one line), `packages/rail/src/escrow/index.ts`, `packages/rail/src/rail.ts` (escrow operations only) and `packages/rail/test/escrow.test.ts`
- **Hub:** `apps/hub/src/bond.ts` (new), plus `apps/hub/src/call.ts`, where you may only add one call to `bond.ts` in each delivery-gate failure branch
- **Hub test:** `apps/hub/test/bond.test.ts` (new)
- **Buyer:** `packages/buyer/src/terms.ts` and `packages/buyer/test/terms.test.ts`
- **Runner:** `packages/runner/src/bond.ts` (new), `packages/runner/src/cli.ts` (a `bond` command) and `packages/runner/test/bond.test.ts` (new)
- **Core:** `packages/core/src/types.ts`, the doc comment of `Offer.bond` only
- **Docs:** `docs/spec/escrow.md` (a bond section and a "Trust and limits" paragraph) and `docs/spec/offer.md` (the bond row)
- **Report:** `.packets/reports/cs-19-seller-bond.md`

## What to build

### 1. Contract (Solidity 0.8.28, cancun, OpenZeppelin 5.6 as today)

**Constructor**

- Add a fourth argument, `address arbiter_`, stored as the immutable `arbiter`.
- Revert `ZeroAddress` when it is zero.

**Free bond per payee**

- `mapping(address payee => uint256) public bondOf;`
- **`depositBond(address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)`**
  - Anyone may submit it. It pulls with `receiveWithAuthorization(payee, address(this), amount, …)` and checks the exact balance delta, as `_pull` does.
  - It credits `bondOf[payee]` and emits `BondDeposited(payee, amount)`.
  - A zero amount reverts `ZeroAmount`.
- **`withdrawBond(uint256 amount)`**
  - The payee withdraws from its own free bond only, and it emits `BondWithdrawn`.
  - Asking for more than the free bond reverts `BondMissing(payee, amount, bondOf[payee])`.

**Per-job bond**

- Keep a separate `mapping(bytes32 jobId => uint256) private _jobBond`, with the view `bondOfJob(jobId)`.
- **Do not change the `Job` struct or `jobOf`.** The verifier decodes `jobOf` the same way on the old and new deployments.

**Funding**

- Keep `fund(offerHash, cs)` exactly as today (bond 0).
- **`fundBonded(bytes32 offerHash, Countersignature calldata cs, uint256 bond)`** shares the same internal path, and when `bond > 0`:
  - it requires `bondOf[cs.payee] >= bond`, else reverts `BondMissing(payee, bond, available)`;
  - it moves `bond` from `bondOf[payee]` to `_jobBond[jobId]`;
  - it emits `BondLocked(jobId, payee, bond)`.

**Close paths**

- **`release`, `refund` and `cancel`** return the job's bond to `bondOf[payee]` and emit `BondReturned(jobId, payee, bond)`. With no bond they behave exactly as today.
- **`failDelivery(bytes32 jobId)`**
  - Only `arbiter` may call it; anyone else reverts `NotArbiter`.
  - The job must be Funded (else `NotFunded`), and `block.timestamp <= job.deadline` (else `DeadlinePassed`).
  - It sets the new status `Failed`, appended **after** `Refunded` in the enum.
  - It transfers `amount + bond` to the buyer, with no toll, and emits `DeliveryFailed(jobId, buyer, amount, bond)`.
- Checks-effects-interactions and `nonReentrant` throughout, as today.

### 2. Forge tests (`contracts/test/Bond.t.sol`, with the existing mock token)

1. **Delivering seller:** deposit, `fundBonded`, `release`. The seller gets the payment minus the toll, and the free bond returns.
2. **Failing seller:** deposit, `fundBonded`, `failDelivery` by the arbiter. The buyer receives exactly `amount + bond`, and the seller's free bond drops by `bond`.
3. **Silent seller:** deposit, `fundBonded`, a warp past the deadline, `refund` by a stranger. The buyer gets `amount`, and the bond returns to the seller.
4. **The comparison test.** Snapshot, run the job and fail it, record the seller's wallet plus free bond, revert to the snapshot, run the same job silent, and record again.
   - The failing run ends exactly `bond` lower.
   - The buyer ends exactly `bond` higher in the failing run.
5. **`fundBonded` refusals:** with less free bond than the bond, it reverts `BondMissing`, and nothing moves.
6. **`failDelivery` refusals:** it reverts for a non-arbiter, after the deadline, and on a released or refunded job.
7. **`cancel`** returns the bond to the seller.
8. **Locked bond:** it cannot be withdrawn, and a withdrawal of the free bond works.
9. **`depositBond`:** a replayed authorization nonce reverts in the token, and nothing is credited twice.

Every existing forge test still passes. `Parity.t.sol` keeps its jobId parity.

### 3. Rail (`packages/rail`)

- **The escrow `challenge`** adds `extra.bond = offer.bond` (an atomic string) to its accepts entry.
- **`settle`** calls `fundBonded(offerHash, cs, bond)` when the hub's own `requirements.extra.bond` is a non-zero atomic string. Otherwise it calls `fund` as today.
- **The escrow operations** gain `failDelivery(jobId): Promise<SettleResult>`. It is sent by the submitter, with the same receipt handling as `release`.
- Export a helper `bondOfPayee(payee): Promise<string>` from the escrow rail, for the hub and the runner.
- **Anvil tests in `escrow.test.ts`:**
  - deploy with the arbiter set to the submitter;
  - a bonded fund locks the bond;
  - `failDelivery` pays the buyer the amount plus the bond;
  - a bonded fund with no deposit fails settle with a clear reason.

### 4. Hub (`apps/hub/src/bond.ts` and one call in `call.ts`)

- **`failOnGate(rail, jobId)`.**
  - When the rail has `escrow.failDelivery`, call it.
  - On success, store the tx as the job's `closeTx` and return the message "Refused. The seller's output does not match the offer. Your payment and the seller's bond are returned to you now."
  - Otherwise return null, and the caller keeps today's message.
- **Call it only in the two delivery-gate branches:**
  - the output or slip does not check out;
  - the slip hash does not commit the body.

  A runner error or a timeout is not a gate failure. Those keep today's path: the deadline refund, with the bond returned to the seller.
- **`apps/hub/test/bond.test.ts`,** with a fake escrow rail:
  - a gate failure calls `failDelivery` once and answers with the new message;
  - a runner error does not call it;
  - a rail without `failDelivery` keeps today's message.

### 5. Buyer (`terms.ts`)

- For a countersign entry, `extra.bond`, when present, must equal `offer.bond`. Otherwise refuse with "Refused. The hub's bond differs from the offer's."
- Add a test.

### 6. Runner (`packages/runner/src/bond.ts` and `cli.ts`)

`bond deposit <atomic> --escrow <addr> [--rpc <url>]`, `bond withdraw <atomic> …` and `bond show …`.

- The key comes from `CS_SELLER_KEY`. `--rpc` defaults to Arc testnet.
- **`deposit`** signs `ReceiveWithAuthorization` (from the seller to the escrow, a random nonce, valid for 10 minutes) under the token's domain, read from the escrow's `token()`, with name "USDC" and version "2" on Arc, overridable by flags. The seller then submits `depositBond` itself.
- **Output:** each command prints the tx hash, and `show` prints the free bond.
- **`packages/runner/test/bond.test.ts`** runs on anvil with the mock token.

### 7. Docs

- **`docs/spec/escrow.md`:**
  - the four cases in the table above;
  - the new functions and events;
  - **Trust and limits:** the arbiter (the hub's relayer) decides failure on the hub's gate; a dishonest hub could slash a bond; the bond is only as strong as that gate.
- **`docs/spec/offer.md`:** `bond` is now collected when the escrow supports it.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never deploy, never call a faucet and never use a public RPC.** Tests run on anvil only. The integrator deploys.
- Use only fixed anvil test keys. TypeScript strict, no `any`. No view code.

## Acceptance

From the worktree root:

```
bun install && forge build && forge test && bun run typecheck && bun test packages/rail apps/hub packages/buyer packages/runner && bun test
```

Every command passes, with no new skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #93)`, and no trailers. Write `.packets/reports/cs-19-seller-bond.md`. Do not push, merge or deploy.
