# wc-09c: the Whitechain relay and rail follow escrow v2.1

Issue: #98. **Design: decided.** cs-wc wrote it on Opus against the v2.1 interface:
- STEER-2205;
- orch-cs's decided interface, at 16:35Z;
- cs-32's fleet ABI, on `origin/cs/32-v21-fleet-abi` at `f5ecf01`.

Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/wc-09c`. That is PR #198's branch (`cs/wc-09b` at `579d315`) with cs-32's interface merged in, so all of this exists already:
- `Rail.settle(payment, requirements, opts?: { lockSig?: Hex })`;
- `EscrowOps.dispute?(jobId, status, buyerSig)`;
- `escrowV2Abi`'s `fund(offerHash, cs, lockSig)` and `dispute(jobId, status, buyerSig)`;
- `escrowRail` appends `opts?.lockSig ?? "0x"` to `fundArgsV2(...)`.

## What v2.1 changes for Whitechain

- **A bonded job needs the payee's `Lock(jobId)` signature at `fund`,** which reverts `LockMissing` without it. An unbonded job passes `"0x"`.
- **`dispute` signs and sends the job's status:** 1 for Funded, 5 for Delivered.
- **`cancel` works only on a Funded job.** A Delivered job reverts `NotOpen`.

## Decisions

### Relay: `packages/relay`

1. **Funding with a Lock (`relayer.ts`).**
   - `EscrowFundCall` gains `lockSig?: Hex`.
   - On version 2, `toContractCall` sends `fund` with the args `[...fundArgsV2(offerHash, payload), call.lockSig ?? "0x"]`.
   - Version 1 is unchanged.
2. **Disputing with a status (`relayer.ts`).** `EscrowDisputeCall` gains `status: number`, and its args become `[jobId, status, buyerSig]`.
3. **Settle carries the Lock (`server.ts` and `countersign-scheme.ts`).**
   - `POST /settle` accepts an optional `lockSig`, a hex string, beside `paymentPayload` and `paymentRequirements`.
   - `settleCountersign` passes it to `fundCall(...)` for a v2 escrow.
   - For a v2 job whose terms carry `bond > 0`, a missing `lockSig` returns `{ success: false, errorReason: "lock_missing" }` **before anything is submitted or simulated**.
4. **Verify does not ask for a Lock (`countersign-scheme.ts` `check()`).**
   - **Why:** the hub calls `verify` before the runner signs the Lock, so verify never has one.
   - **Bonded v2 job** (`bond > 0`): skip the fund simulation in `check()`. Signatures and terms are still checked. The settle path simulates with the real `lockSig` before submitting.
   - **Unbonded job, either version:** simulate exactly as today, with `lockSig` `"0x"` on v2.
5. **Dispute carries the status (`server.ts`, `escrow-ops.ts`).**
   - `POST /escrow/dispute` requires `status`, an integer from 0 to 255; anything else is a 400.
   - `disputeJob` passes it into the call. The relay forwards the status the buyer signed and never derives it; the chain checks it.
6. **No cancel from Delivered (`escrow-ops.ts`).**
   - `cancelJob` drops `fromDelivered: true`, so a Delivered job answers `job_not_open` before any call.
   - `close()` keeps the `fromDelivered` option for nothing else. Remove the option if nothing uses it.

### Rail: `packages/rail/src/whitechain/index.ts`

7. **Settle forwards the Lock.** `settle(payment, requirements, opts?)` posts `{ paymentPayload, paymentRequirements, ...(opts?.lockSig ? { lockSig: opts.lockSig } : {}) }` to `/settle`.
8. **Dispute forwards the status.** On v2, `escrow.dispute(jobId, status, buyerSig)` posts `{ jobId, status, buyerSig }` to `/escrow/dispute`.

## Tests (no network)

1. **v2 fund arguments.** A bonded v2 settle with `lockSig` sends `fund` with that `lockSig` as the third argument. An unbonded v2 settle sends `"0x"`.
2. **No Lock.** A bonded v2 settle without `lockSig` returns `lock_missing`, with no simulate and no submit.
3. **Verify.** For a bonded v2 job, verify succeeds without simulating `fund`. For an unbonded v2 job, verify simulates.
4. **Dispute.** `/escrow/dispute` without a valid `status` is a 400. With one, the call carries `[jobId, status, buyerSig]`.
5. **Cancel.** Cancel on a Delivered v2 job answers 422 `job_not_open`, with no call made.
6. **The rail.** `settle` posts `lockSig` when given and omits it otherwise. `dispute` posts `status`.
7. **Existing tests.**
   - **Changed with the interface,** and nothing else: wc-09's tests that call dispute without a status, and that cancel from Delivered, take the v2.1 shapes. **List each changed test, old to new, in your report.**
   - **Unedited:** every other test.

## Lease

- `packages/relay/src/{relayer,server,countersign-scheme,escrow-ops}.ts`
- `packages/relay/test/*`
- `packages/rail/src/whitechain/index.ts`
- `packages/rail/test/whitechain*.test.ts`

Touch nothing else. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #98`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `.packets/reports/wc-09c-v21-align.md` in your worktree and commit it. Include the list of changed tests, old to new.
