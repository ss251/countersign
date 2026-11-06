# cs-32-v21-fleet-abi: the fleet speaks escrow v2.1

Branch `cs/32-v21-fleet-abi`, from `cs/int`. The packet changes the fleet half only; `contracts/**`,
`packages/relay/**` and `packages/rail/src/whitechain/**` are untouched.

## Diff summary

### `packages/core/src/countersign.ts`

- Added `LOCK_TYPES = { Lock: [{ name: "jobId", type: "bytes32" }] }` beside `CANCEL_TYPES`.
- Added `lockTypedData(chainId, escrow, jobId)`, with `primaryType: "Lock"` and the escrow domain.
- `DISPUTE_TYPES` now carries `jobId` and `status` (`uint8`).
- `disputeTypedData(chainId, escrow, jobId, status)` signs `{ jobId, status }`, with the status
  documented as the job's status when signed: Funded (1) or Delivered (5).
- No index edit was needed: `packages/core/src/index.ts` already re-exports `countersign.ts`, so
  `LOCK_TYPES`, `lockTypedData`, `DISPUTE_TYPES` and `disputeTypedData` are exported.

### `packages/rail/src/escrow/abi-v2.ts`

- `fund` gains `lockSig` (`bytes`) after the Countersignature tuple.
- `dispute` becomes `(bytes32 jobId, uint8 status, bytes buyerSig)`.
- The file lists no errors, so no error entries were added.

### `packages/rail/src/rail.ts` and `packages/rail/src/escrow/index.ts`

- `Rail.settle` gains `opts?: { lockSig?: Hex }`; every rail remains assignable because the
  parameter is optional and only the escrow v2 rail reads it.
- The v2 `fund` call passes `[...fundArgsV2(extra.offerHash, p), opts?.lockSig ?? "0x"]`.
- `EscrowOps.dispute` is now `dispute?(jobId, status, buyerSig)`; the v2 implementation passes
  `[jobId, status, buyerSig]`. The v1 branch is unchanged.

### `apps/hub/src/review.ts`

- A dispute's status is `5` when the stored job is `delivered`, otherwise `1`.
- Recovery uses `disputeTypedData(chainId, address, job.jobId, status)`.
- The single `submitting.call(...)` is split: accept calls `escrow.accept(jobId, signature)` and
  dispute calls `escrow.dispute(jobId, status, signature)`. Accept is otherwise unchanged.

### `packages/buyer/src/review.ts`

- `disputeJob` signs `disputeTypedData(chainId, escrow, jobId, status)`.
- The status is carried out of `fundedOn`: the escrow read that already finds the holding job
  supplies Funded (1) or Delivered (5); a recorded escrow uses an injected `readJob` when present,
  otherwise the journal's slip delivery (`5`) or an open funded job (`1`).
- The direct-dispute ABI is `(bytes32 jobId, uint8 status, bytes buyerSig)`.
- A direct dispute sends `dispute(jobId, status, "0x")`.

### New tests

- `packages/core/test/v21-typed-data.test.ts`: checks the two Solidity typehashes, recalculates
  the `Lock` and `Dispute` digests from `hashDomain` plus `encodeAbiParameters`, and recovers
  signatures from `lockTypedData` and from `disputeTypedData` with status 1 and 5.
- `packages/rail/test/v21-calls.test.ts`: captures the v2 wallet calls and checks that `settle`
  with `{ lockSig }` encodes it as `fund`'s third argument, that `settle` without opts encodes
  `0x`, and that `escrow.dispute(jobId, 5, sig)` encodes `(jobId, 5, sig)`.

## Every changed line in an existing test

### `packages/core/test/review.test.ts`

- L50-L52: `disputeTypedData(CHAIN, ESCROW, JOB)` became
  `disputeTypedData(CHAIN, ESCROW, JOB, 1)`, and the expected digest type string became
  `Dispute(bytes32 jobId,uint8 status)` with `[JOB, toHex(1, { size: 32 })]`.
- L73: `disputeTypedData(CHAIN, ESCROW, JOB)` became
  `disputeTypedData(CHAIN, ESCROW, JOB, 1)`.

### `apps/hub/test/review.test.ts`

- L50: `disputeCalls` element type gained `status: number`.
- L68-L69: `escrow.dispute = async (jobId, status, buyerSig)` and the pushed record gained
  `status`.
- L170: `disputeSig(jobId, status, signer = buyer)` now signs
  `disputeTypedData(CHAIN, ESCROW, jobId, status)`.
- L215: delivered dispute signs with status `5`.
- L232: funded dispute signs with status `1`.
- L242: refused delivered dispute signs with status `5`.
- L252: refused funded dispute signs with status `1`.

### `packages/buyer/test/review.test.ts`

- L222: `disputeTypedData(5042002, ESCROW_A, jobId)` became
  `disputeTypedData(5042002, ESCROW_A, jobId, 1)`.

### `packages/buyer/test/dispute-direct.test.ts`

- L64: the local dispute ABI gained `{ name: "status", type: "uint8" }`.
- L167: the expected calldata arguments became `[JOB_ID, 1, "0x"]`.

### `packages/rail/test/escrow-v2.test.ts`

- L187: the reference `fund` ABI gained `{ name: "lockSig", type: "bytes" }`.
- L226: the expected `fund` args became `[...fundArgsV2(payload.terms.offerHash, payload), "0x"]`.
- L244: `escrow.dispute!(jobId, sig)` became `escrow.dispute!(jobId, 5, sig)`.

## Acceptance

From the worktree root:

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

- `bun install --linker hoisted`: 870 installs checked, 668 packages, no changes.
- `bun run typecheck`: passed.
- `bun test`: **1200 pass, 3 skip, 0 fail**, 4444 `expect()` calls, 1203 tests across 140 files.
- `forge test`: **47 passed, 0 failed, 0 skipped**, 5 suites.
