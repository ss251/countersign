# tr-01: refuse a call nested inside a purchase of the same offer or seller, before any 402 (refs #27)

**Design: decided.** cs-truth wrote this on Opus from the captain's acceptance (STEER-2050) and `docs/decisions.md` D17, which is already committed on this branch. Implement exactly what follows. Nothing here is left for you to choose.

## Goal

A call whose lineage already contains the seller or the offer it is about to buy is refused before payment, with a 4xx and no 402.

## Decisions

1. **What lineage is.** `CallRequest.lineage` in `packages/core/src/wire.ts`: the jobIds of the purchases this call is nested inside, outermost first. `paidCall` in `apps/hub/src/call.ts` already reads it with `hexList(call.lineage)` from `apps/hub/src/util.ts`.
2. **The function.** Add to `apps/hub/src/call.ts`:

   ```ts
   /** D17: true when an ancestor purchase this hub knows bought the target offer, or an offer from its seller. */
   export function lineageCycle(store: Store, target: StoredOffer, lineage: Hex[]): boolean
   ```

   For each `jobId` in `lineage`:
   - `const ancestor = store.getJob(jobId)`. If it is `null`, skip it: this hub cannot see that purchase.
   - If `ancestor.offerHash.toLowerCase() === target.offerHash.toLowerCase()`, return `true`.
   - `const bought = store.getOffer(ancestor.offerHash)`. If it is not `null` and `sameText(bought.seller, target.seller)`, return `true`.

   Return `false` when no entry matches. Import `StoredOffer` as a type from `./store.ts`, and `Store` the same way if it is not already imported.
3. **Where it runs.** In `paidCall`, immediately after the line `const input = call.input;` and before `checkEnsLock`:

   ```ts
   if (lineageCycle(deps.store, stored, hexList(call.lineage))) {
     return failure(
       409,
       "lineage-cycle",
       "Refused. This call is nested inside a purchase of the same offer or from the same seller, so it would close a cycle. Nothing was charged.",
     );
   }
   ```

   This puts it before the ENS lock, both input gates, the online check, the rails, any 402 and any payment verify or settle.
4. **Nothing else changes.** Lineage is stored, forwarded and signed exactly as today. Add no new validation of lineage entries. Make no change to the buyer, the runner, the rails or `packages/core`.

## Lease

- `apps/hub/src/call.ts`: the function and the one check above, nothing else;
- `apps/hub/test/lineage.test.ts`: new.

Read only: everything else. Never commit `bun.lock`.

## Tests (`apps/hub/test/lineage.test.ts`, no network)

Build the setup the way `apps/hub/test/call.test.ts` and `apps/hub/test/frontdoor.test.ts` do:
- `startHub()`, `makeOffer`, `publishOk`, `seller` and `other` come from `apps/hub/test/support.ts`.
- To put an ancestor job in the store, copy the `jobFor(...)` helper pattern from `frontdoor.test.ts` and call `hub.store.putJob(...)`.
- For the cases that expect a 402, the offer must be online. Start a runner with `startRunner` from `apps/hub/test/runner-client.ts` and await `ready`, as `call.test.ts` does.
- `call()` in `support.ts` sends no lineage. Send these calls with a direct `fetch` to `${hub.url}/offers/${hash}/call`, method `POST`, header `content-type: application/json`, body `JSON.stringify({ input, lineage })`, where `input` is a value that passes `makeOffer`'s input schema.

Setup:
- **Offers.** Offers A and B by `seller`, different titles so the hashes differ. Offer C by `other`.
- **Ancestor jobs.** Job J1 on offer A. Job J2 on offer C.

Cases:
1. **Same offer.** Calling A with lineage `[J1]` answers 409 with `code` `"lineage-cycle"`, and the response has no `PAYMENT-REQUIRED` header.
2. **Same seller, another offer.** Calling B with lineage `[J1]` answers 409 `lineage-cycle`.
3. **Deeper in the lineage.** Calling B with lineage `[J2, J1]` answers 409 `lineage-cycle`.
4. **Unrelated ancestor.** Calling A with lineage `[J2]`, with a runner online for A, answers 402.
5. **Unknown jobId.** Calling A with a lineage holding one jobId the store does not have (`0x` followed by 64 nines), with a runner online for A, answers 402.
6. **No lineage.** Calling A with no lineage, with a runner online, answers 402.
7. **Order of checks.** Calling A with lineage `[J1]` and an input that fails the schema answers 409 `lineage-cycle`, not 422.
8. **Unit.** `lineageCycle` returns `false` for an empty lineage, and `true` for each of cases 1 to 3 when called directly.

Every existing hub test still passes, unedited.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Existing tests:** never edit, weaken, skip or delete one to make it pass. If one fails, fix the code, or stop and report the root cause.
- **Commits:** small, present tense, ending `refs #27`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- `paidCall`, `failure`, `hexList`, `Store.getJob` or `Store.getOffer` differ from what this packet names;
- a failure survives three different fixes;
- 40 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/tr-01-cycle-refusal.md`: the diff summary, the test names, and the gate output counts.
