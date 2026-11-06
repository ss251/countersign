> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 1a8f1ed (PR 145, cs/ui-approve, #21): the phone countersigns held calls

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## Held
- **The decision.**
  - The phone signs core's `approvalDecisionBody` v2. `requestHash = approvalRequestHash(request)`, and the offer hash, amount, rail and terms are taken from the agent-signed request, never from the hub's copies.
  - The decision is EIP-191 over canonical JSON, the same bytes the hub and the agent rebuild, so it can clear only this request (B14).
- **Before signing.**
  - `requestSig` must recover over `canonicalJson(request)` to the approval's agent, and `request.agent` must be that agent.
  - Offer hash, amount, rail and title must equal the approval's.
  - A failure signs nothing and sends nothing.
- **A phone approving a stranger's agent harms no one.** A hub can show a request from an agent of its own, but a decision for that agent clears only that agent's own spend.

## Should-fix
1. **What the human sees is not all bound to what the agent signed.**
   - The screen shows the seller's name, the payee address (`offer.seller`) and the offer hash (`listing.hash`) from the hub's listing. The envelope checklist is computed from those same hub values.
   - `checkRequest` ties only the title to the signed request.
   - The money is safe: the agent pays the payee its own terms check bound to `request.offerHash`. But the human's consent can be dressed up. A hub can show a trusted seller's name and address beside a request whose offer pays someone else.
   - Fix:
     - Refuse unless `canonicalHash(approval.listing.offer)` and `listing.hash` both equal `request.offerHash`.
     - Show the payee and amount from `request.terms` (`payTo`, `amount`), the values the agent signed.
     - Compute the checklist from those values.

## Note
- **The approver key is a raw hex key in `localStorage`.** Any script injection on the console's origin can read it and approve held calls, within the envelope's cap. That is acceptable on testnet if it is said where the key is made.
