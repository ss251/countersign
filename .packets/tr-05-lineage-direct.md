# tr-05: a lineage that names the offer or its seller directly is refused before any 402 (refs #27)

**Design: decided.** cs-truth wrote this on Opus from the captain's STEER-2235 item 4 and `docs/decisions.md` "D17, amended", which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

A call whose lineage contains its own offer hash, or its seller's address, is refused with 409 `lineage-cycle` before any 402. There is a test for exactly that.

## Decision

In `apps/hub/src/call.ts`, `lineageCycle(store, target, lineage)` already resolves each lineage entry as a jobId. At the top of the loop body, before `store.getJob(jobId)`, add:

```ts
if (sameText(jobId, target.offerHash) || sameText(jobId, target.seller)) return true;
```

`sameText` is already imported in that file. Nothing else changes: the jobId resolution, the 409 response, and where the check runs in `paidCall` all stay as they are.

## Lease

- `apps/hub/src/call.ts`: the one line above, nothing else;
- `apps/hub/test/lineage-direct.test.ts`: new.

Read only: everything else, including the existing `apps/hub/test/lineage.test.ts`. Never commit `bun.lock`.

## Tests (`apps/hub/test/lineage-direct.test.ts`, no network)

Build the setup exactly as `apps/hub/test/lineage.test.ts` does: `startHub`, `makeOffer`, `publishOk`, a runner from `runner-client.ts` for the 402 cases, and a direct `fetch` with body `{ input, lineage }`. Use offer A by `seller`, offer B by `seller`, and offer C by `other`.

1. **Its own offer hash.** Calling A with lineage `[A's offerHash]` answers 409 `lineage-cycle` with no `PAYMENT-REQUIRED` header.
2. **Its seller's address.** Calling A with lineage `[seller's address]` answers 409 `lineage-cycle`.
3. **Case does not matter.** Calling A with lineage `[A's offerHash in upper case after the 0x]` answers 409 `lineage-cycle`.
4. **Another offer's hash.** Calling A with lineage `[C's offerHash]`, with a runner online for A, answers 402. C is by another seller and is not a job on this hub.
5. **Unit.** `lineageCycle(hub.store, storedA, [A's offerHash])` and `lineageCycle(hub.store, storedA, [seller's address])` are `true`, and `lineageCycle(hub.store, storedA, [C's offerHash])` is `false`.

Every existing test still passes, unedited, including the eight in `lineage.test.ts`.

## Constraints

- **No browser** of any kind. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Never run `git stash`.** Every worktree of a clone shares one stash stack. Use a temporary commit or a second worktree.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #27`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `lineageCycle` or `sameText` differ from what this packet names;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `~/Developer/countersign-mac/reports/tr-05-lineage-direct.md` (on the MacBook): the diff summary, the test names, and the gate output counts.
