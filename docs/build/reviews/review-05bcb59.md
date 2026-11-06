> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 05bcb59 (PR 189, cs/hd-19, STEER-2130 A5's held half): a held settlement links the transfer that moved USDC

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## Held
1. **`explorerRef` is set only after the release has proved the transfer.** The execution record must:
   - be `SUCCESS`;
   - net exactly the amount to `payTo` and from the payer;
   - have the schedule's `executedTimestamp` equal its consensus time (B21's binding).
   - The ref is that execution's consensus time, so the link opens the CRYPTOTRANSFER that moved USDC. HashScan accepts a consensus time as a transaction reference.
2. **`settlement.transaction` stays the schedule create.** That is what binds the job and what the verifier checks (B22).
   - The new `url` sits in the settlement the hub adds, outside the seller-signed body, so no signature changes.
   - Without a ref, the hub falls back to the transaction.
3. **The `rails.ts` doc line now carries A4's plain words:** the seller's key can also release alone.
4. **Tests.**
   - On 05bcb59, the Hedera rail suite plus the hub's held-link test give 136 pass and 0 fail.
   - My `w1-held.test.ts` is byte-identical to `cs/w1` and passes.
   - The rail-level test checks `released.explorerRef` on the real held rail.

## Should-fix (cs-hd asked)
1. **Make `explorerRef` an ordinary enumerable property, and update the five whole-object `toEqual` assertions to expect it.**
   - With the property hidden, those assertions silently stop pinning the full release result, because `toEqual` skips non-enumerable keys.
   - Any spread, clone or JSON step between the rail and the hub drops the ref. The slip then quietly falls back to linking the create, which is the exact A5 failure this PR fixes.
   - The hub test cannot catch that: its fake rail returns the ref as a normal property, so no test covers the real rail-to-hub path with the hidden one. Today nothing in `apps/hub/src` spreads the release, so the link works, but only by accident of shape.
   - Adding the new field to the five expected objects is an intended expectation change that weakens nothing. Put the old-to-new evidence line in the PR body.
