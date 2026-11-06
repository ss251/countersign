# hd-13b-held-review: the held rail confirms its own schedule, promises only what is true, and refuses an admin key

## Goal

This is the single corrective for cs-w1's review of a3608ce (`/Users/thescoho/Developer/countersign-mumbai/reports/review-a3608ce.md`), branched from hd-12 (a3608ce), in parallel with hd-13.

- **Blocker B21.** Release confirmed the execution record of whatever create transaction the payment named, not the schedule it held. hd-13, running in parallel on its own branch and merged after this one, binds `createTxId` to `scheduleId` in `verify`. It is **not** on this branch. This packet adds the release-side check, which on its own makes B21 pass.
- **The should-fix.**
  - The failure message and refund promised "no money moves" while the seller can still sign before expiry.
  - The review notes that a schedule with an admin key can be deleted by the buyer after delivery.

cs-w1's failing test, `packages/rail/src/hedera/test/w1-held.test.ts`, is already on this branch (from cs/w1 5c24dac). It must pass unedited. Tracked by issue #41.

## Lease

- `packages/rail/src/hedera/held.ts`: `escrow.release`, `escrow.refund`, `escrow.cancel`, and one check in `verify`.
- `packages/rail/src/hedera/schedule.ts`: `MirrorSchedule.adminKey`, `RawSchedule.admin_key`, and `normalizeSchedule` only.
- `apps/hub/src/call.ts`: the `hedera-scheduled` sentence in `failedDelivery` only.
- Tests:
  - `packages/rail/src/hedera/test/held-b21.test.ts` (new);
  - `packages/rail/src/hedera/test/held.test.ts`, only the refund and cancel expectations this packet changes;
  - `apps/hub/test/held.test.ts`, only the message assertion.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-13b-held-review.md`

Never edit `w1-held.test.ts` or any other `w1-*` test.

## The decided design

1. **`schedule.ts`.**
   - `RawSchedule` gains `admin_key?: unknown`.
   - `MirrorSchedule` gains `adminKey: unknown`. `normalizeSchedule` sets `adminKey: raw.admin_key ?? null`.
   - Nothing else changes.
2. **`held.ts` `verify`.** Add one check after the `wait_for_expiry` check and before the hold-window check: `if (schedule.adminKey !== null) return invalid("admin_key")`.
3. **`held.ts` `escrow.release`.** After the existing execution-record checks pass (`result === "SUCCESS"` and the exact +/- amounts), read `getSchedule(hold.scheduleId, mirror)`.
   - `executedTimestamp` missing (or the read returns null) is failure `execution_failed: schedule not executed`.
   - `schedule.executedTimestamp !== record.consensusTimestamp` is failure `execution_failed: schedule executed elsewhere`.

   Only then delete the hold and return success, as today. Any failure keeps the hold.
4. **`held.ts` `escrow.refund(jobId)` and `escrow.cancel(jobId, sellerSig)`.** Both use the same logic:

   | Condition | Result |
   |---|---|
   | No hold | failure `unknown_job` |
   | `getSchedule` returns null | failure `unknown_schedule`; keep the hold |
   | `executedTimestamp` set | failure `executed`; keep the hold |
   | `deleted`, or `secondsOf(expirationTime) !== null && now() >= secondsOf(expirationTime)` | success `{ success: true, payer: hold.payer, transaction: hold.createTxId, network }`, and delete the hold |
   | Anything else (still pending and signable) | failure `still_signable`; keep the hold |

5. **`call.ts`.** The `hedera-scheduled` message in `failedDelivery` becomes exactly:

   > Not delivered. This hub will not submit the seller's countersignature. Your USDC stays in your account unless the seller signs the schedule itself before it expires.

6. **The countersign bytes are never stored.** Confirm in the report, by reading the code, that the hub never writes `delivered.countersign` to the store, a log or a failure record, so a failed gate drops them with the request. If any path stores them, remove that path and say so.

## Tests (offline; no network)

**`held-b21.test.ts`.** Build fixtures as `held.test.ts` does.

- **`release` checks the held schedule itself.**
  - With the execution record SUCCESS and exact but the schedule's `executed_timestamp` null, the result is `execution_failed: schedule not executed`, and a later correct release still succeeds.
  - A different `executed_timestamp` gives `execution_failed: schedule executed elsewhere`.
  - An equal one succeeds.
- **`refund` and `cancel`.**
  - Pending: `still_signable`, and the hold remains, so a refund after the expiration then succeeds.
  - Expired: success.
  - Deleted: success.
  - Executed: `executed`.
  - A 404 schedule: `unknown_schedule`.
- **`verify`.**
  - With `admin_key: { _type: "ED25519", key: "ab" }` on the schedule: `admin_key`.
  - With `admin_key: null`: it passes as before.

**Also:**
- `w1-held.test.ts` passes unedited.
- In `held.test.ts`, the refund and cancel tests that expected success for a pending schedule now expect `still_signable`. Name them in the report.
- `apps/hub/test/held.test.ts` asserts the new sentence.
- Every other existing test passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run a script under `scripts/hedera/`.** **No network** in tests. **No keys:** never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera apps/hub && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-13b` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
