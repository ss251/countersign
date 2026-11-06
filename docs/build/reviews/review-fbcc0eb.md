> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review fbcc0eb (PR 186, cs/tr-02, #26, D18): seller-signed delisting and a runner canary

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This is c7d6219, which orch-cs cleared, merged with cs/int.

## Held
1. **Delist.**
   - `POST /offers/:hash/delist` recovers the EIP-191 signer of `countersign delist <hash>` and refuses with 401 unless it is the stored seller.
   - An unknown offer is 404, and a second delist is idempotent.
2. **The runner is not a signing oracle for the hub.**
   - Every EIP-191 text the seller key signs starts with a fixed phrase: `countersign runner <nonce>` (hello), `countersign offer <hash>`, `countersign delist <hash>`, and now `countersign canary <hash> <nonce>`.
   - The canary's hash is taken from the runner's own served list, and the hub-chosen nonce comes last.
   - So a hub cannot get a delist or publish signature out of a canary or a hello. Slip signatures are EIP-712, which EIP-191 text can never collide with.
3. **The canary.**
   - It runs only with `CANARY=1`, and only checks offers whose runner is online.
   - It makes 3 attempts, 5 s apart, each with a 10 s timeout, and delists only when all of them fail.
4. **Tests.** On fbcc0eb with a frozen install, the hub's canary and delist tests plus the runner's canary test give 14 pass and 0 fail.

## Notes
1. **A canary delist cannot be undone in the hub.** Nothing re-lists an offer, so the seller has to publish a new offer (a new hash) to come back. That makes orch-cs's rule load-bearing: `CANARY=1` stays off until every live runner answers canaries. Consider letting a seller-signed publish of the same hash re-list it.
2. **The delist text carries no nonce or time.** That is harmless while nothing re-lists. Add one if re-listing ever comes.
