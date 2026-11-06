# cs-33b-lock-funder-fleet

The fleet signs `Lock(bytes32 jobId,address funder)`. A bond above zero needs a review window of at least 60 seconds, the same floor as `minDuration`.

## Diff summary

`LOCK_TYPES` is now `{ Lock: [{ name: "jobId", type: "bytes32" }, { name: "funder", type: "address" }] }`. `lockTypedData(chainId, escrow, jobId, funder)` returns `message: { jobId, funder }`, with `funder` checksummed. cs-w1's `packages/core/test/w1-lock-funder.test.ts` is copied verbatim from `origin/cs/w1` and passes. Its digest is `Lock(bytes32 jobId,address funder)`.

The hub-to-runner `lock` frame carries `funder: Address`. `Rail` gains `readonly funder?: Address`, documented as the address that submits `fund`. The escrow rail sets it from the wallet client's account, then the submitter, and leaves it undefined when there is no wallet client. Every other rail leaves it undefined.

On a bonded call the hub sends `funder: match.rail.funder`. When that is undefined it answers 503 `rail-unavailable` — "Refused. This rail cannot fund a bonded job right now. Nothing was charged." — and does not ask the runner. The runner refuses a funder that is not a 20-byte hex address with `lock-refused` / `bad-funder`. Otherwise it signs `lockTypedData(frame.chainId, frame.escrow, frame.jobId, frame.funder)`.

`assertOffer` rejects a bond above zero whose `reviewWindow` is under 60, with the new message. `bond terms` does the same for `--review-window`, keeps the existing `--min-duration` floor of 60, and the usage line states both floors.

## Every changed test line

`packages/core/test/w1-lock-funder.test.ts` is new and unedited. `cmp` against `git show origin/cs/w1:packages/core/test/w1-lock-funder.test.ts` matched.

`packages/core/test/bond-window.test.ts`

- message: `offer.bond above zero needs offer.reviewWindow of at least 60 seconds: a bond protects a buyer who can refuse a delivery`
- added: `test("bond 1 with window 59 throws", () => { expect(() => assertOffer(offer({ reviewWindow: 59 }))).toThrow(new OfferError(MESSAGE)); });`

`packages/core/test/v21-typed-data.test.ts` (existing lock test, funder argument and the encoding it pins)

- `const FUNDER: Address = "0x5555555555555555555555555555555555555555";`
- `const LOCK_TYPEHASH = keccak256(toBytes("Lock(bytes32 jobId,address funder)"));`
- `function lockDigest(jobId: Hex, funder: Address)`
- `encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [LOCK_TYPEHASH, jobId, funder])`
- `expect(LOCK_TYPEHASH).toBe(keccak256(toBytes("Lock(bytes32 jobId,address funder)")));`
- `const td = lockTypedData(CHAIN, ESCROW, JOB, FUNDER);`
- `expect(hashTypedData(td)).toBe(lockDigest(JOB, FUNDER));`

`apps/hub/test/bond-window.test.ts`

- added the test `a signed offer with a bond and a 59 second window is 400 and is not stored`: `makeOffer({ bond: "1", reviewWindow: 59 })`, status 400, `listOffers()` length 0, public `/offers` length 0.

`apps/hub/test/lock.test.ts`

- `import type { Address, Hex } from "viem";`
- `const SUBMITTER = "0x6666666666666666666666666666666666666666" as Address;`
- `readonly funder?: Address;` plus a constructor that sets it when passed
- `rail = new RecordingRail(SUBMITTER);`
- `lockTypedData(frame.chainId, frame.escrow, frame.jobId, frame.funder)`
- lock frame expectation gains `funder: SUBMITTER`
- added `a bonded call on a rail with no funder answers 503 and sends no lock`: status 503, code `rail-unavailable`, the refusal sentence above, `runner.locks` length 0, `settleCalls` length 0

`packages/runner/test/bond-window.test.ts`

- message: `Refused. A bond needs --review-window of at least 60 seconds: a bond protects a buyer who can refuse a delivery.`
- added `--bond 100 --review-window 59` through `parseBondArgs`, expecting that message

`packages/runner/test/lock.test.ts`

- `import { recoverTypedDataAddress, verifyTypedData } from "viem";`
- `const FUNDER = "0x5555555555555555555555555555555555555555" as Address;`
- existing verify spreads `lockTypedData(CHAIN_ID, ESCROW, JOB_ID, FUNDER)`
- `sendLock` default frame gains `funder: FUNDER`
- added: a frame naming funder `0x6666…6666` recovers to the seller over `lockTypedData(..., that funder)`
- added: funder `0x1234` is `lock-refused` with reason `bad-funder`

No other test expectation was changed.

## Counts

From the worktree root, after `bun install --linker hoisted`:

- `bun run typecheck` — exit 0.
- `bun test` — 1446 pass, 5 skip, 0 fail. 5856 expect() calls. 1451 tests across 194 files. The five skips are the live Whitechain checkout, the three Arc fifth-check tests, and the STEER-2225 bundle scan. An earlier full run failed one unrelated case, `canary > a runner signing with the wrong key delists its offer`, with `publish failed with 405`. That file passes alone (6 pass) and the full suite passed on the rerun. The hub has no 405 for publish. It is not this change.
- `forge test` — 5 suites, 47 passed, 0 failed, 0 skipped.

Isolated check, second worktree of the final commit, `bun install --frozen-lockfile && bun run typecheck`: exit 0.

Implementation commits on `cs/33-runner-hub-lock`: `e957d3d` sign Lock over the job and its funder (refs #98); `7f5bd19` refuse a bonded review window under 60 seconds (refs #98). This report is the commit after those two. Not pushed.
