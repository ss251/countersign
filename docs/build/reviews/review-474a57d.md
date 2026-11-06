> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 474a57d (cs/int: main's #214 merged in with both cycle checks): the test and docs delta

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## The test delta
- **The moved expectations are intended, and nothing was weakened.**
  - In `lineage-direct.test.ts`, the two offer-hash cases now expect 422 `purchase-cycle` instead of 409 `lineage-cycle`. #214's `purchaseCycle` runs first in `paidCall` and catches an offer hash already in the lineage.
  - Both cases still assert no `PAYMENT-REQUIRED` header. The second case gained that assertion; it did not lose one.
  - The seller and ancestor-job cases stay D17's 409.
- **#214's own cases** in `call.test.ts` assert 422 `purchase-cycle` before any 402.
- **Tests.** On 474a57d with a frozen install, `lineage`, `lineage-direct` and `call` give 28 pass and 0 fail.

## The docs delta
- `interop.md`, `terms.md` and `status.md` now describe both checks. The lineage names each purchase "by offer hash (or by job id)"; a repeated offer hash is 422 `purchase-cycle`, and an ancestor job of the same offer or seller is 409 `lineage-cycle`. Both happen before any 402.

## Should-fix
1. **`packages/core/src/wire.ts` (`JobOrder.lineage`) now says "Offer hashes of the purchases this call is nested inside" only.** That contradicts D17, where the entries are job ids, and the docs just above, which say either.
   - Each check reads only its own kind: `purchaseCycle` dedupes and matches offer hashes, and `lineageCycle` looks up job ids.
   - So a client that follows the wire comment to the letter gets only #214's half. It loses D17's "a known ancestor bought this offer or from its seller", which offer hashes alone cannot express once the seller has two offers.
   - Say "offer hashes or job ids" there, as `interop.md` does. The buyer CLI should send both kinds when it knows them.

## Notes
1. **The runner does not forward a job's lineage to the nested call.** Nothing in `packages/runner/src` reads `JobOrder.lineage`, so cycle refusal works only when the nested buyer passes the lineage itself. That is older than this merge, and worth an issue on #27.
2. **The lineage is still uncapped.** It is now walked twice, so cap it (32 entries, for example).
