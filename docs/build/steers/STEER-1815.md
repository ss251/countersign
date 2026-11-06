> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 18:15 IST: #98 goes to Rajdeep; the landing goes first in the UI queue

## orch-cs: issue #98 is Rajdeep's

The project lead created issue #98, "Dispute resolution window: accept, dispute, release-after-window", and assigned it to Rajdeep (TheRealRajdeep).
- It points at your `docs/spec/escrow.md` section "Escrow v2" as the decided design.
- It scopes him to:
  - the contract paths;
  - six tests: accept early; dispute inside the window; release after the window and one second early; deadline refund with no delivery; a late dispute reverting; a third party unable to dispute without the buyer's signature;
  - the two redeployments, keeping the v1 addresses;
  - one-command accept and dispute in the buyer CLI.

**Coordinate; do not duplicate:**

1. **cs-19 stays on the bond only.** No fleet packet builds the review or dispute half.
   - Do not start cs-21.
   - If any branch already holds review or dispute work, commit it as it stands, push it through cs-w4 and post the branch and sha on #98 as his base. Do not delete or redo it.
2. **One editor at a time on `CountersignedEscrow.sol`.**
   - cs-19 is editing it now.
   - When cs-19 has passed review and merged into `cs/int`, comment on #98 that the contract is free, with the `cs/int` sha he builds on.
   - Until then, tell him on #98 which parts he can do without touching the contract file (the CLI commands, test scaffolding).
   - After that, the fleet keeps out of the contract until his PR lands.
3. **One combined redeploy, under #98, with bond and review together.** Do not redeploy the bond separately.
   - Offer to run the Arc redeploy through Studio from his merged code, so the Studio story holds. Whitechain 1874 goes through forge.
   - Old addresses stay and go in `docs/proof.md`.
4. **Keep cs-ui and cs-wc unblocked.** Serve the job review fields from the spec now in `/jobs` and `/orders`: `status in_review`, `deliveredAt`, `reviewEndsAt`, `reviewWindow`, `acceptedAt`/`acceptTx`, `disputedAt`/`disputeTx`. Use whatever the hub knows today, and null where the chain does not report yet. The buyer screen can then offer Accept and Dispute against stable shapes.
5. **His PRs are reviewed by cs-w1** (Opus now) and get my cross-model review of the contract diff before the redeploy. Post REVIEW-REQ as usual when he opens it.

## cs-ui: the landing, now, ahead of all other polish (project lead)

What shipped at 10:46 is honest but still a console page, not a landing. Root `/` becomes the landing, built exactly as `ui/DESIGN-NOTE.md` section "The landing" says:

1. The statement `payments that only move when the work lands`, set large.
2. A live desk fed by `/stats` and `/settlements`:
   - offers listed, jobs settled, USDC settled;
   - rails live, with chain names;
   - a stream of the last settlements, each with seller, price, rail, age and explorer link.
3. The ask box, wired to the assistant.
4. The three steps.
5. The proof links and the repo.

**Rules for it:**
- Dark by default with our ink palette; light everywhere else.
- The app routes stay where they are. The landing is the front door, not a separate site.
- **The numbers must be live, never fixture: the whole point of the design is that it is evidence.** If `/stats` lacks a total, ask orch-cs for the field.
- The project lead's hero loop comes later from the firstmate under `apps/web/public/media`. Leave a poster slot and never block first paint on it.

**Before it merges:** raise NEEDS-BROWSER for 1440 and 390, dark and light, against the production hub. The project lead sees the screens before the merge.

The buyer Accept/Dispute screen continues once the landing is up.
