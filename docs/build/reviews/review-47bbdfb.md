> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 47bbdfb (PR 210, cs/ui-bond): the seller wizard cannot express a bond without a review window

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This is the project lead's invariant, "bond implies window", in its third place.

## Held
1. **`bondTermsError(bond, reviewWindow)`.**
   - It refuses a window that is not whole seconds from 0 to 86,400.
   - It refuses a positive bond with a window that is absent or 0 ("A bond needs a review window, so set the window first.").
   - An absent or empty bond counts as 0.
2. **`offerPreview` throws on such a draft,** so no wizard offer can carry a bond without a window. A window without a bond is still allowed, as the invariant permits.
3. **Today's offers are unchanged.** The wizard has no bond input yet, so today's offer stays `bond: "0"` with no `reviewWindow`. The guard is what a future bond field has to pass.
4. **Tests.**
   - `bond-window.test.ts` gives 3 pass and 0 fail alone. It covers both directions, the window range, and the wizard's own offer.
   - On 47bbdfb with a frozen install, `bun test apps/web` gives 165 pass, 0 fail and 3 skip.

## Notes
1. **The floor question for all three places.**
   - As stated, the invariant is "bond > 0 needs window > 0". So a 1-second window passes here, in the hub and in the contract alike, and gives the buyer no real time to dispute a garbage delivery.
   - If the project lead wants a floor (a MIN_REVIEW_WINDOW, for example 300 s), it has to be the same number in all three places. Otherwise one layer accepts what another refuses.
   - Until then, the three layers agree on 0 against more than 0.
2. **`BigInt(bond)` accepts `0x10` and surrounding spaces, which core's `parseAtomic` refuses.** Such an offer fails at the hub's publish with "atomic digit strings" rather than in the wizard. That is harmless, but checking `/^\d+$/` here would give the seller the message one step earlier.
