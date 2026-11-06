> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Steer, 19:40 IST: the project lead's decisions and the plan to midnight

## Decided: the arbiter and the bond (for #98, which Rajdeep owns)

**The arbiter keeps exactly one job:** `failDelivery` on a gate failure. It is out of the terms entirely and can never set them.
- On Arc the arbiter is the hub relayer: the production hub's relayer, the key that runs the gate. orch-cs confirms the address on #98.
- On Whitechain the arbiter is the relay key.

**The terms come from signatures, not from the arbiter.**
- Bond and reviewWindow come from the offer, which the seller already signed.
- Both go into the countersigned jobId, so the payee consented when publishing, and nobody can front-run `fund` to strip the bond. `fund` stays open to anyone who holds the countersignature.
- This kills M1 and the arbiter's ability to invent terms, with no new payee signature.
- Design note (orch-cs, to Rajdeep): the contract must still bind the bond it locks to the bond the payee signed. Otherwise C1 comes back in a new form. Spell out how in docs/spec/escrow.md; the project lead's re-audit will check exactly this.

**The bond economics:**
- A deadline refund pays the buyer amount + bond, so defaulting costs the seller.
- A dispute inside the window pays the buyer amount + bond, so junk costs the same as no delivery.
- A voluntary cancel returns the bond to the payee.
- Aggressive disputes are the accepted trade tonight, held in check by short windows and reputation.

**Replaced by this:**
- the arbiter-supplied bond and window in `fundBonded`;
- the payee lock signature;
- packet cs-24 (the runner's bond lock), which is cancelled.

cs-23's hub wiring follows the new interface.

## The schedule (IST)

1. **By 20:15: the landing merges and deploys.** That is PR #136 as it stands, with the project lead's step 3b words. The console redeploys from main right after, and the firstmate shoots production.
2. **By 21:30, in parallel: approvals live on production.**
   - cs-ui generates `HUMAN_APPROVAL_TOKEN` and sets it on the production hub. It is never printed or committed.
   - The console signs version 2 decisions (cs-13c's requestHash and nonce).
   - The production-hub e2e flow goes green. A broken approval path is the one gap that makes the phone look fake.
3. **By 22:00: contract v2 lands.**
   - It carries all four audit fixes as decided above and the six dispute tests, red shown before green.
   - The project lead re-runs the audit on the branch before it merges.
   - Then come the two redeploys: Arc through Studio (orch-cs) and 1874 by forge (cs-wc).
4. **At 22:00: hard feature freeze.** Nothing new starts, and e2e runs green. The video and the submission get the rest of the night.

**If the contract is not green by 22:00:** do not deploy a half-audited bond to buy time. `docs/status.md` marks it IN PROGRESS, and we ship the dispute window as design plus buyer signatures.
