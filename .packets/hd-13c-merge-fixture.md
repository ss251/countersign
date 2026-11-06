# hd-13c-merge-fixture: teach the B21 test's fake mirror the schedule's create record

## Goal

`cs/hd-13b` now merges hd-13. hd-13's `verify` requires the payload's `createTxId` to be the schedule's own successful SCHEDULECREATE. That is `findCreate` in `packages/rail/src/hedera/held.ts`, which reads `/api/v1/transactions/<mirror id>` without `?scheduled=true`.

hd-13b's `packages/rail/src/hedera/test/held-b21.test.ts` was written before that check. Its fake mirror answers every `/api/v1/transactions/` path with the execution record. So its two admin-key tests now stop at `create_mismatch`:

- "refuses an admin key in any form"
- "accepts a schedule with no admin key"

Fix the fixture only. Tracked by issue #41.

## Lease

- `packages/rail/src/hedera/test/held-b21.test.ts`: the `mirrorBox` fetch only.
- Report: `$M/reports/hd-13c-merge-fixture.md`

## The decided change

In `mirrorBox`'s fetch, for a path that starts with `/api/v1/transactions/`:

- **With `scheduled=true`** in the URL's query, answer exactly as today: `{ transactions: state.transaction ? [state.transaction] : [] }`.
- **Without it**, answer with this create record, which is the shape `findCreate` accepts:

  ```
  { transactions: [{ transaction_id: <the path's last segment>, name: "SCHEDULECREATE", entity_id: SCHEDULE_ID, result: "SUCCESS", scheduled: false }] }
  ```

Change nothing else, in this file or any other.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera apps/hub packages/runner packages/buyer && bun test && forge test
```

Every command passes, with no new skips. `w1-held.test.ts` passes unedited. Commit on `cs/hd-13b` with one short present-tense message ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.

## Constraints

- **No browser.** **No network.** **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Never stage `bun.lock`.** Change nothing outside the lease.
