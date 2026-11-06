# wc-09b: two corrections to wc-09's v2 close path

Issue: #98. This is the corrective for wc-09 (`af09921`), found by cs-wc in review.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/wc-09` (`af09921`), which already carries wc-09.

## Fix 1: closing a delivered job wipes its slip hash

- **What happens now:** `deliverJob` stores the slip hash when a v2 release lands with a review window. Then `closeV2` (accept, dispute and release-after-window) calls `closeJob` with no slip hash. `closeJob` runs `slip_hash = ?` with `null`, which erases the slip hash the delivery recorded. An accepted order would then show no slip, although one exists on chain.
- **Decision:** in `packages/relay/src/ledger.ts` `closeJob`, write `slip_hash = COALESCE(?, slip_hash)`. A slip hash passed in still wins. A missing one keeps the stored value.
- **Nothing else changes in `closeJob`.**

## Fix 2: a failed `reviewOf` read after a confirmed release

- **What happens now:** in `packages/relay/src/escrow-ops.ts` `close()`, a v2 release confirms on chain and then `reviewOf(jobId)` is read. If that read throws, `close()` throws. The relay answers with an error although the release already landed, the hub may treat it as failed, and the ledger keeps the job as `funded`.
- **Decision, part (a): record the window at fund.** In `packages/relay/src/countersign-scheme.ts` `settleCountersign`, a v2 job records `reviewWindow` from `payload.terms.reviewWindow`, or 0 when it is absent. Add `reviewWindow?: number` to `NewJob` and write it to the existing `review_window` column in `recordJob`. A v1 job records `null`, as today.
- **Decision, part (b): never throw after a confirmed transaction.** In `close()`'s v2 release branch, wrap the `reviewOf` read in `try/catch`.
  - **The read succeeds:** do exactly what wc-09 does now.
  - **The read throws, and the job's recorded `reviewWindow` is greater than 0:** call `deliverJob` with `deliveredAt = now (ms)` and `reviewEndsAt = deliveredAt + reviewWindow * 1000`, keeping the slip hash, and reply `{ ok: true, transaction, url, status: "delivered" }`.
  - **The read throws, and the recorded `reviewWindow` is 0 or null:** close as `released`, exactly as for a job without a window.
- **The rule:** once the relayer reports `confirmed`, `close()` always returns `{ ok: true, ... }`.

## Lease

- `packages/relay/src/ledger.ts`
- `packages/relay/src/escrow-ops.ts`
- `packages/relay/src/countersign-scheme.ts`
- `packages/relay/test/*`

Touch nothing else, and no view code. Never commit `bun.lock`.

## Tests (no network: simulated chain reads and relayer, as wc-09's tests do)

1. **The slip hash survives a close from Delivered.** A v2 job is delivered with slip X. After `accept`, `getJob` and the order both carry slip X. The same holds after `releaseAfterWindow`, and after `dispute` from Delivered.
2. **The window is recorded at fund.** A v2 settle records `reviewWindow` from the terms. A v1 settle records `null`.
3. **A failed `reviewOf` with a recorded window.** A confirmed v2 release where `reviewOf` throws, on a job whose recorded window is 3600, replies 200 with `status: "delivered"`. The ledger shows `delivered`, with `reviewEndsAt = deliveredAt + 3,600,000`.
4. **A failed `reviewOf` without a window.** The same failure on a job whose recorded window is 0 replies 200 with `status: "released"`, and the ledger shows `released`.
5. **Existing tests.** Every existing test passes **unedited**, wc-09's included.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree. All worktrees of a clone share one stash stack.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #98`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green. If the typecheck reports `Buffer` or `@types/node` errors in files outside the lease, that is the install layout; rerun `bun install --linker hoisted` and check again before reporting.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `.packets/reports/wc-09b-v2-close-fixes.md` in your worktree and commit it, saying what changed and what each test proves.
