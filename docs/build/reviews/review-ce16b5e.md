> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review ce16b5e (PR 196, cs/ui-A13, STEER-2130 A1 and A3, stacked on #187)

Reviewer: cs-w1. Result: **blockers=1 should-fix=2**. The blocker and both should-fixes are the ones from my #187 review. They now live in the shared purchase path, so one fix closes them on both PRs.

## Blocker
**B24 applies to the shared purchase path.**
- `lib/purchase.ts`'s `usePurchase().buy(offerHash, input)` signs the 402's `payTo`, `amount` and `extra.offerHash`, while the start desk and the assistant card show the listing's price.
- In wallet mode, the assistant's hold now signs through it as well.
- Failing test: `apps/web/test/w1-start-terms.test.ts` on `cs/w1`. The original is 8da81f2. a5a5bb0 lets it find `trustedRequirement` in `lib/purchase.ts` or in `routes/start/index.tsx`, with the assertions unchanged.
- On ce16b5e it gives 3 fail and 1 pass (the honest control), as on 6902224.
- Fix: pass the shown listing into `buy` and refuse a 402 that differs from it, as the buyer agent's `checkTerms` does:
  - its hash;
  - `payTo = offer.payTo?.escrow ?? offer.seller`;
  - `amount = offer.price`;
  - `deadlineSeconds = offer.deadline`;
  - and `listing.hash = offerHash(listing.offer)`.

## Should-fix (now in `ui/PurchaseResult.tsx`)
1. **Line 61: "The hub refused, and nothing moved" is false once the payment has been funded.**
   - It shows after 502 `failed-delivery` and 502 `release-failed`, when the money is in escrow.
   - It also shows after a settle error, when the fund transaction may still land.
   - Say it only before payment, or when the hub's message says "Nothing was charged".
2. **Line 42: "The escrow holds your payment until the output checks out" is false on success.**
   - On the pinned v1 escrow, the hub answers 200 only after `escrow.release` has landed, so the seller already has the payment.

## Held
1. **A1, the offer's terms per rail kind.** Each rail's own `/rails` declaration drives the copy:
   - **Escrow:** the money waits in the contract on its chain, with the refund window and the release gate.
   - **Held:** A4's words. The schedule moves nothing until the seller's key signs, this hub submits it only after a checked delivery, and the seller's key alone can also release it.
   - **Direct and batched:** the rail's finality, and "pays before delivery, so a failed delivery returns nothing".
   - **Not declared:** says so.
   - The deadline words never promise a refund on a rail that pays first. The failed-delivery note promises the money back only when every rail is escrow.
   - The audit's test is in: an offer with only gateway and hedera renders no escrow, refund or release-gate promise.
2. **A3, the assistant's hold.**
   - It signs with the wallet only when connected on Arc and the offer takes the escrow rail (`cardMode`).
   - Otherwise it is labelled "Hold to get your agent's command", including to screen readers. The card never says Countersigned.
   - The card shows the example input it sends, and prices in the asset of the rail it shows.
3. **The curl sends `{input}`.**
4. **Tests.**
   - `start.test.ts` changes only its import path, to `lib/purchase.ts`. `cardMode.test.ts` and `terms.test.ts` are new.
   - On ce16b5e with a frozen install, `bun test apps/web` gives 170 pass, 0 fail and 3 skip (the CS_LIVE on-chain suite).
   - No lockfile or package.json change.

## Notes
1. When v2 deploys, "after N without delivery, anyone can refund" becomes N + 10 minutes (`settleBy`), and a bonded refund pays the buyer the bond too. Move this copy together with the pin.
2. My #187 notes stand for the shared path: show the hub when a link chose it, and show the faucet link only on balance refusals.
