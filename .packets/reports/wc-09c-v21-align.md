# wc-09c: the Whitechain relay and rail follow escrow v2.1

Issue: #98. Implemented the decided v2.1 interface on top of `origin/cs/wc-09c`
(`6a226da`, cs-32's fleet ABI merged into PR #198).

## Relay

- `relayer.ts`
  - `EscrowFundCall` carries `lockSig?: Hex`. On version 2, `toContractCall` sends
    `fund(...fundArgsV2(offerHash, payload), lockSig ?? "0x")`. Version 1 is unchanged.
  - `EscrowDisputeCall` carries `status: number`; the call is `[jobId, status, buyerSig]`.
- `countersign-scheme.ts`
  - `fundCall` accepts the Lock as a fourth argument and puts it on the call.
  - `check()` skips the `fund` simulation for a bonded v2 job (`terms.bond > 0`), because the hub
    verifies before the runner signs the Lock. Signatures and terms are still checked by the rail.
    Unbonded jobs simulate exactly as before; v2 simulates with `"0x"`.
  - `settleCountersign` reads the optional top-level `lockSig`, validates that it is a hex string,
    and returns `lock_missing` for a bonded v2 job without one (or with `"0x"`) before submitting
    or simulating. A supplied Lock is passed to `fundCall`, so `submit` simulates with it.
- `server.ts`
  - `/settle` already hands the whole body to `settleCountersign`, so the optional `lockSig`
    arrives there.
  - `/escrow/dispute` requires an integer `status` in 0..255; anything else is 400. The status is
    forwarded unchanged.
- `escrow-ops.ts`
  - `disputeJob` takes `status` and puts it on the `escrowDispute` call.
  - `cancelJob` no longer sets `fromDelivered`; `close()` no longer has that option. A Delivered
    job answers `job_not_open` before any simulation or transaction.

## Rail

`packages/rail/src/whitechain/index.ts`

- `settle(paymentPayload, paymentRequirements, opts?)` posts
  `{ x402Version, paymentPayload, paymentRequirements, ...(opts?.lockSig ? { lockSig } : {}) }`.
- On v2, `dispute(jobId, status, buyerSig)` posts `{ jobId, status, buyerSig }`.

## Tests added

`packages/relay/test/wc-09c-v21.test.ts`

1. `a bonded v2 settle sends the Lock as fund's third argument`
2. `an unbonded v2 settle sends 0x`
3. `a bonded v2 settle without a Lock is lock_missing with no simulate and no submit`
4. `a bonded v2 job verifies without simulating fund`
5. `an unbonded v2 job verifies by simulating with 0x`
6. `a missing or invalid status is 400`
7. `the call carries [jobId, status, buyerSig]`
8. `a delivered v2 job answers 422 job_not_open with no call`
9. `a funded v2 job still cancels`

`packages/rail/test/whitechain-v21.test.ts`

1. `settle posts lockSig when given and omits it otherwise`
2. `dispute posts the status the buyer signed`

## Existing tests changed, old to new

`packages/relay/test/wc-09-v2.test.ts`

- Fixture `makeV2Body`: the returned body gains `lockSig: SIG`. This file defaults to a bonded v2
  offer, and v2.1 now requires the Lock at fund. No assertion was changed by this.
- `accept, dispute and release-after-window take the happy path`
  - old dispute body: `{ jobId, buyerSig: SIG }`
  - new dispute body: `{ jobId, buyerSig: SIG, status: 1 }`
- `a job the ledger does not hold is 404`
  - old dispute body: `{ jobId: "0x12…12", buyerSig: SIG }`
  - new dispute body: `{ jobId: "0x12…12", buyerSig: SIG, status: 1 }`
- `a v1 job is 409 not_supported_on_v1`
  - old dispute body: `{ jobId, buyerSig: SIG }`
  - new dispute body: `{ jobId, buyerSig: SIG, status: 1 }`
- `from delivered, accept and releaseAfterWindow release, dispute disputes, cancel cancels`
  - renamed to `from delivered, accept and releaseAfterWindow release, dispute disputes`
  - old dispute call: `disputeJob({ jobId, buyerSig: SIG }, ctx)`
  - new dispute call: `disputeJob({ jobId, status: 5, buyerSig: SIG }, ctx)`
  - old cancel case: `cancelJob(...)` expected `"cancelled"` with `closeVia === null`
  - new: the cancel case is removed from the loop and covered by
    `from delivered, cancel is refused as job_not_open with no call` (expects
    `{ ok: false, reason: "job_not_open" }`, no write, still `delivered`).

`packages/relay/test/wc-09b-v2-close.test.ts`

- `dispute` case in `the slip hash survives a close from delivered`
  - old call: `disputeJob({ jobId, buyerSig: SIG }, ctx)`
  - new call: `disputeJob({ jobId, status: 5, buyerSig: SIG }, ctx)`

`packages/rail/test/whitechain-v2.test.ts`

- `the v2 ops call the right routes with the right bodies`
  - old call: `ops.dispute!(JOB, SIG)`
  - new call: `ops.dispute!(JOB, 5, SIG)`
  - old expected body: `{ jobId: JOB, buyerSig: SIG }`
  - new expected body: `{ jobId: JOB, status: 5, buyerSig: SIG }`

No other test was changed.

## Verification

```
bun install --linker hoisted   # 870 installs checked, 668 packages, no changes
bun run typecheck              # passed
bun test                       # 1254 pass, 3 skip, 0 fail, 4729 expect() calls, 1257 tests, 147 files
forge test                     # 47 passed, 0 failed, 0 skipped, 5 suites
```

Two consecutive standalone full `bun test` runs were green. `bun.lock` was not modified.
