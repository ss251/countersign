> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 17:50 IST: buyer acceptance with an optimistic review window (project lead: close the gap now)

## The gap, in the project lead's words

"The hub checks the output against the offer's declared output schema, hashes the delivered output and binds that hash into the slip, and release needs only the seller's EIP-712 signature over jobId and slipHash. So we verify shape, integrity, seller identity and the price the buyer signed, and the buyer's only remedy against bad work is that a seller who never signs gets refunded at the deadline. A seller who delivers junk, signs, and takes the money is not stopped."

## What to build (orch-cs owns the contract, hub, verifier and buyer CLI)

1. **Release** is available to the seller only after either:
   - the buyer co-signs acceptance; or
   - a **review window** has elapsed since delivery and the buyer has not disputed.
2. **`dispute(jobId)`:** callable by the buyer before the deadline. It blocks release and routes the job to the existing refund path.
3. **Refund after the deadline** stays exactly as it is.
4. **Events:** emit `Accepted` or `Disputed`, so the slip records which happened. Also record "released after the window" when nobody acted. Mind the hash rule: the committed hash covers the body without the settlement receipt, so put the acceptance record on the settlement side unless you can show it is safe in the body, and write the choice in `docs/decisions.md`.
5. **The window length** lives in the offer terms, never hardcoded. A few minutes is the default for our offers.
6. **Forge tests that must exist:**
   - the buyer accepts early and the seller is paid;
   - the buyer disputes and the seller cannot release;
   - nobody acts and release succeeds after the window;
   - the seller never delivers and the deadline refund still works;
   - **the bond's cases still pass** (see below).
7. **Buyer CLI:** acceptance is one action (`accept <jobId>`), with `dispute <jobId>` beside it.
8. **`docs/spec/escrow.md`:** add the new state names, for example `funded → delivered → (accepted | disputed | window elapsed) → released / refunded`.

## One contract revision, one redeploy

cs-19-seller-bond is changing the same contract right now.

- **Do not run two contract changes in parallel, and do not redeploy twice.** Start `cs-20-acceptance-window` on top of cs-19's branch the moment cs-19 exits and passes review. It takes the same extra slot.
- **Then one combined testnet redeploy:** Arc through Studio as before, and Whitechain 1874 with forge.
  - Keep the old escrow addresses, so earlier slips still verify.
  - Put both sets in `docs/proof.md`.
  - Update the hub, the rails, the verifier, the relay (cs-wc) and the e2e config to the new address.
- **The bond and disputes:** a buyer dispute routes to the refund path and **does not slash the bond.** Only a delivery that fails the hub's gate slashes it, per the bond rule. If that reading is wrong, the firstmate asks the project lead.

## Review

This is the core money path.
- cs-w1 reviews the contract diff, the hub and the CLI.
- The firstmate also runs an independent second review of the contract diff from a different model family, before the redeploy.
- Post `REVIEW-REQ <sha> <branch> contracts/` when the diff is ready, and wait for both before deploying.

## Other lanes

- **cs-ui:** the web approval screen makes acceptance one action ("Accept delivery"), with Dispute as a quieter second action, and shows the window as a live countdown in mono. Use the state names from `docs/spec/escrow.md`. Build it against the hub's new fields as orch-cs posts them.
- **cs-wc:** the Whitechain relay and the merchant desk show the new states (in review, accepted, disputed) and switch to the new escrow address after the redeploy.
- **cs-e2e:** add the four acceptance flows live on Arc after the redeploy, plus the bond comparison flow.
