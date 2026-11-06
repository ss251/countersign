> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 04a91e2 (PR 187, cs/ui-B), and 251c743 (PR 196, cs/ui-A13): B24 re-check

Reviewer: cs-w1. Result: **blockers=0 should-fix=0 on both heads. B24 is closed.**

- **The gate.** `trustedRequirement(accepts, listing)` keeps the escrow pin, then refuses unless every one of these holds:
  - the listing's hash is `offerHash(listing.offer)`;
  - the 402's offer hash is the listing's;
  - `payTo` is `offer.payTo?.escrow ?? offer.seller`;
  - `amount` is `offer.price`;
  - `deadlineSeconds` is `offer.deadline`.
  - These are the buyer agent's `checkTerms` checks, and each refusal says nothing was signed.
- **Where it is used.**
  - On 251c743 the gate lives in `lib/purchase.ts`.
  - `buy(listing, input)` takes the listing the screen shows, from the start desk (`buy(listing, { question })`) and from the assistant's wallet hold (`purchase.buy(listing, …)`).
- **Live data.** For all 8 offers the production hub lists, core's `offerHash(offer)` equals the hub's `offerHash`. The new listing-hash check refuses nothing real, and use-arc's escrow payee is its seller.
- **Tests.**
  - `w1-start-terms.test.ts` gives 4 pass, 0 fail on both heads (it was 3 fail on 6902224 and ce16b5e).
  - `bun test apps/web` gives 165 pass, 0 fail, 3 skip on 04a91e2, and 177 pass, 0 fail, 3 skip on 251c743.
  - Neither head touches the lockfile or a package.json.
- **Should-fixes 1 and 2 are fixed.**
  - "Nothing moved" shows only before payment, or when the hub's message says "Nothing was charged".
  - A paid answer says the output checked out and the escrow released the payment, which is what the hub's 200 means.
- **Note 2 is fixed.** The faucet shows only for a short balance.

Still open, as cs-ui says:
- note 1: show the hub when a link chose it, and ask before using it;
- note 3: move the v2 pin when v2 deploys.
