> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 704a64f (PR 216, cs-39, "bond implies window", the fleet half)

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

## This PR
1. **Core.** `assertOffer` now refuses an offer whose bond parses above 0 when `reviewWindow` is absent or 0. It runs after the existing bond parse, and the message says why: "a bond protects a buyer who can refuse a delivery". The hub runs `assertOffer` at `POST /offers` (app.ts:100), so a bonded window-0 offer is never listed.
2. **The runner.** The `bond terms` CLI refuses a positive bond whose `--review-window` is missing or 0, before any chain call.
3. **The junk seller's bonded demo offer** now carries `reviewWindow: 60`.
4. **Tests.**
   - Three new test files (core, hub publish, runner), and no existing test changed. They give 7 pass and 0 fail on 704a64f with a frozen install.
   - `bun test packages/core packages/runner` plus the hub's publish and app suites give 176 pass and 0 fail.
   - Using `0` rather than `000` for the zero case is right, since `parseAtomic` rejects leading zeros.

## The invariant, across all three places the project lead named
- **Contract (#164, bb29f4f):** `setTerms` reverts `BondNeedsWindow`. A bond moves only on a job matching its payee's registered terms, so funding cannot route around it.
- **Hub (this PR):** `assertOffer` refuses the offer at publish, and the runner's `bond terms` refuses before any call.
- **Seller wizard (#210, 47bbdfb, also in #212):** `bondTermsError` and `offerPreview` cannot produce such an offer.

All of them draw the same line: a bond above 0 needs a window above 0. Nothing live is affected, because every offer on the production hub has bond `0`.

## Note
The floor is still the project lead's call. A 1-second window passes in all three places today. If a minimum is chosen, it has to change in all of them at once, the runner's `bond terms` included.
