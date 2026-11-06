# hd-08c-schedule-review-fixes: a schedule is released only after the mirror has had time, and the seller refuses schedules that would not pay now

## Goal

Review of `25e508b` (hd-08b, the scheduled checkout, issue #41) found 0 blockers and two should-fixes. This packet applies both, exactly as decided below. Every other behaviour stays as it is.

1. **The expiry release can trust a lagging mirror.**
   - `releaseExpired` releases a hold as soon as the agent's clock passes the expiration and the mirror shows no execution. A seller's sign that reached consensus just before expiry shows up on the mirror seconds later, so in that window the agent logs `expired` although the transfer ran.
   - `spentFromLog` then skips any later `spend` for that schedule, and the envelope undercounts for good.
2. **The seller's check ignores `wait_for_expiry` and the schedule's payer.**
   - With `wait_for_expiry` true, the seller's sign succeeds and nothing moves until expiry, and the buyer can empty its account in between.
   - With a payer other than the buyer, the seller can be made to pay the scheduled transfer's fee.

## Lease

- `packages/rail/src/hedera/schedule.ts`: `countersignSchedule`, `ScheduleRefusedError`'s reason type, and one doc comment
- `packages/buyer/src/hedera/agent.ts`: `releaseExpired`, `spentFromLog` and one exported constant only
- New tests only, in two new files: `packages/rail/src/hedera/test/schedule-review.test.ts` and `packages/buyer/src/hedera/test/release.test.ts`. Do not edit the existing test files.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-08c-schedule-review-fixes.md`

## Required (decided)

1. **`agent.ts`: export `RELEASE_MARGIN_SECONDS = 60`.**
2. **`releaseExpired(hold)`:**
   - Read the schedule with `getSchedule(hold.scheduleId, opts.mirror)` from `@countersign/rail/hedera`, not `scheduleStatus`.
   - Missing record: return `"pending"`.
   - `executedTimestamp` is set: return `"executed"`, with no log entry and no change to `spent`.
   - Otherwise release only when `record.deleted` is true, **or** `now() >= expirationSeconds + RELEASE_MARGIN_SECONDS`, where `expirationSeconds` is the integer seconds part of `record.expirationTime` (the text before the `.`). In every other case return `"pending"`.
   - The release itself, the once-only guard and the `expired` entry stay exactly as today.
3. **`spentFromLog`:**
   - Keep a set of schedule ids released by an `expired` entry.
   - A later `spend` entry whose `schedule` is in that set adds its amount back, once per schedule: the release was wrong, and the money moved.
   - A second such `spend` for the same schedule adds nothing.
   - A `spend` for a schedule that has a `schedule` entry and no release still adds nothing, as today.
4. **`countersignSchedule`.** After the status check, before decoding the body:
   - `record.waitForExpiry === true` throws `new ScheduleRefusedError("wait_for_expiry", "Refused. The schedule waits for its expiry, so the seller's key would not pay now.")`;
   - `record.payer !== expected.payer` throws `new ScheduleRefusedError("payer_mismatch", "Refused. The schedule names a fee payer other than the buyer.")`;
   - in both cases, no `ScheduleSignTransaction` is built or sent;
   - `ScheduleRefusedError`'s `reason` type gains `"wait_for_expiry" | "payer_mismatch"`.
5. **Doc comment** on `countersignSchedule`, one sentence: "A successful countersign is not payment: a seller delivers only after `waitForScheduledExecution` returns the executed transfer."

## Tests (offline; fake mirror records, as the existing schedule tests build them)

`packages/buyer/src/hedera/test/release.test.ts`, with an injected mirror `fetch` and a fixed `now`:

- expired by the clock but only 30 s past expiration, with no execution: returns `"pending"` and logs nothing;
- 61 s past expiration, with no execution: returns `"released"` and logs exactly one `expired` entry;
- deleted, before expiration: `"released"`;
- executed: `"executed"`, logs nothing;
- `spentFromLog`:
  - `schedule` (+10000), `expired` (−10000), then a `spend` with the same schedule id (+10000) totals 10000;
  - a second such `spend` totals 10000 still.

`packages/rail/src/hedera/test/schedule-review.test.ts`:

- a schedule record with `wait_for_expiry: true` makes `countersignSchedule` throw reason `wait_for_expiry`;
- a `payer_account_id` other than the expected payer throws `payer_mismatch`;
- in both cases, the seller client stub records no call: give it an `execute` that fails the test if reached.

Every existing test, the `w1-*` tests included, passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No live runs.** No network in tests. No keys.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. TypeScript strict, no `any`.

## Acceptance

```
bun install && bun run typecheck && bun test packages/rail/src/hedera packages/buyer/src/hedera && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-08c` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
