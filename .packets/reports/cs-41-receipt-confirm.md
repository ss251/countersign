# cs-41-receipt-confirm report: a slow receipt is not a failed payment

Branch: `cs/41-receipt-confirm`, created from `cs/int`. #164, #244 and #198 are on it.

Commit:

- `288502c` confirm a landed escrow job when its receipt times out (refs #98)

`apps/hub/src/call.ts` is unchanged.

## Diff summary

`packages/rail/src/escrow/index.ts`:

- `submit` takes an optional `confirm?: () => Promise<boolean>`.
- When `waitForTransactionReceipt` throws (the timeout, or any other wait failure) and `confirm` is set, `submit` calls it once. A throw from `confirm` is `false`.
- `true` returns the same object as a mined receipt: `{ success: true, transaction: hash, network }`, plus `payer` when the call passed one.
- `false` returns the existing `{ success: false, errorReason: "pending", transaction: hash, network }`.
- A mined receipt with `status !== "success"` (including `"reverted"`) still fails with `Refused. The chain reverted the ${label}.` and does not call `confirm`.
- `confirmJob` reads `jobOf(jobId)` and checks a `STATUS` name:
  - `fund` / `settle` (v1 `fund`, v1 `fundBonded`, v2 `fund`): the name is not `none`;
  - `release`: `released` (window 0) or `delivered` (a review window);
  - `failDelivery`: `failed`;
  - `refund` and `cancel`: `refunded`.
- `accept`, `dispute`, `releaseAfterWindow` and `sweepToll` are not in the packet's list. They still return `pending` when the receipt wait throws.

`packages/rail/test/escrow-receipt-confirm.test.ts` (new). No existing test was edited.

Hub check, no line changed:

- `apps/hub/src/call.ts` serves the slip only after `release.success`. It sets `closeTx` to `release.transaction`, writes the slip, and `updateJob`s status `released` or `delivered` with that `closeTx` (the block that starts at the `escrow.release` call). A confirm that returns `success: true` with the submitted hash takes that path. The `502 release-failed` response is the `!release.success` branch only.
- `apps/hub/src/janitor.ts` refunds `store.fundedJobsPastDeadline`. That query is `status IN ('funded', 'failed')` (`apps/hub/src/store.ts`). A confirmed release has already moved the row to `released` or `delivered`, so the janitor does not select it.
- A confirmed fund is `settle.success`, so `claimJob` stores the job as `funded` and `runners.dispatch` runs. The hub no longer treats that landed fund as an unfunded payment. The janitor's refund remains the deadline sweep of a job that is still `funded` or `failed` in the store.

## The five tests

A thrown `waitForTransactionReceipt` stands in for the timeout. Clients are the injected `publicClient` and `walletClient`. No network.

1. `a release whose receipt wait throws is success when jobOf reads Released` — one `jobOf` read, status `released`, result `{ success: true, transaction: <submitted hash>, network }`.
2. `a release whose receipt wait throws stays pending when jobOf reads Funded` — `confirm` runs, status `funded`, result is the existing `pending` failure with the submitted hash.
3. `a fund whose receipt wait throws is success when jobOf reads Funded` — verify still sees `none`; the confirm read sees `funded`. Success carries the submitted hash and the buyer as `payer`.
4. `a reverted receipt fails and does not confirm` — receipt `status: "reverted"`, `jobOf` is not read, error is `Refused. The chain reverted the release.`
5. `a jobOf read that throws during confirm is the pending failure` — the read throws, `release` resolves (it does not throw) with `errorReason: "pending"`.

## Acceptance

From the worktree root, after `bun install --linker hoisted` (no lockfile change):

| Command | Result |
| --- | --- |
| `bun run typecheck` | pass, exit 0 |
| `bun test` | 1740 pass, 5 skip, 0 fail, 6757 expect() calls, 1745 tests across 234 files |
| `forge test` | 100 pass, 0 fail, 0 skipped, 10 suites |

Second worktree of the finished commit, `bun install --frozen-lockfile && bun run typecheck`: pass, exit 0.
