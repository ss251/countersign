# hd-14b-verify-jobid: a held slip's seller-signed jobId must be the job its schedule paid

## Goal

This is cs-w1's blocker B22 on 2321bd7 (`$M/reports/review-2321bd7.md`).

`checkHeld` never ties the payment's `createTxId` to the seller-signed `body.jobId`. A slip for a job that never ran could therefore verify VALID by naming another executed schedule between the same parties.

The hub's jobId for a held payment is `keccak256(toBytes(createTxId))`, because the settlement transaction is the create. The verifier requires exactly that.

cs-w1's failing test `packages/verify/test/w1-verify-held.test.ts` is on this branch, from cs/w1 1e78a3a. It must pass unedited. Tracked by issue #163.

## Lease

- `packages/verify/src/verify.ts`: `checkHeld` only.
- `packages/verify/test/held.test.ts`: fixtures and one new test.
- `packages/verify/test/e2e-163.test.ts`: the one jobId line below.
- Report: `$M/reports/hd-14b-verify-jobid.md`

Never edit `w1-verify-held.test.ts` or any other `w1-*` test.

## The decided change

1. **`checkHeld` in `verify.ts`.** After the settlement-equals-create check and before the ok finding, compute `const derived = keccak256(toBytes(createTxId))` with viem, which is already a dependency.
   - If `body.jobId.toLowerCase() !== derived.toLowerCase()`, add `("countersignature", false, \`the seller signed job ${body.jobId}, not the job this schedule paid (${derived})\`)` and return.
   - Otherwise keep the ok finding unchanged.
2. **`held.test.ts`.**
   - Every held slip fixture gets `jobId: keccak256(toBytes(<its createTxId>))`. That is what a real held slip carries.
   - Add one test: a held slip whose `jobId` is another value gives `valid: false`, with exactly that detail.
3. **`e2e-163.test.ts`.** This is cs-e2e's test. Change exactly one thing: in the `slip()` helper's body, `jobId: h("2")` becomes `jobId: keccak256(toBytes(createTx))`, with `keccak256` and `toBytes` imported from `"viem"`. A real held slip's jobId is the hub's derivation from its create, and the exact slip's check does not read `jobId`. Change nothing else in that file. cs-e2e is told.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/verify && bun test && forge test
```

- Every command passes, with no new skips.
- `w1-verify-held.test.ts` passes unedited.
- `e2e-163.test.ts` passes with only that line changed.

Commit on `cs/hd-14` with short present-tense messages ending `refs #163`, and no trailers. Write the report. Do not push, merge or deploy.

## Constraints

- **No browser.** **No network.** **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Never stage `bun.lock`.** No new dependencies. Change nothing outside the lease. TypeScript strict, no `any`.
