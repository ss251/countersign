> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer, 19:50 IST: the judge's verdict re-prioritises the night (project lead). This replaces STEER-1940 wherever they conflict

The verdict: finalist, yes. Six sponsor tracks come out as one possible win, two places and three losses, and two of those losses are self-inflicted. The new order follows.

1. **Whitechain rail on production (by 20:45). Owners: cs-wc and orch-cs.**
   - Host the relay alone on Railway: the relayer key as a Railway secret, payees pinned, the hourly WBT ceiling on. This is cs-wc's option (a), and the project lead has said go.
   - Set `WC_RELAY_URL` on the production hub, so that `/rails` lists Whitechain 1874.
   - Prove it with one paid Whitechain call through the production hub.
2. **The suite is green and LATEST.md shows it (by 20:45). Owners: cs-e2e, with orch-cs publishing LATEST.md.**
   - Scope out only what genuinely depends on production configuration. The approvals check is scoped out, because the per-call approval path is dropped (item 5); say so in the report.
   - A judge will open LATEST.md.
3. **One contract (by about 22:45). Owners: Rajdeep (the contract), orch-cs (wiring, the Arc deploy, the demo job) and cs-wc (the 1874 deploy).**
   - Main's escrow has an arbiter and `failDelivery`, while the deployed Arc escrow at 0x19c2 reverts on `arbiter()`, so we are presenting two different contracts.
   - Deploy the fixed v2 contract with the four audit fixes, as decided in STEER-1940: the arbiter does `failDelivery` only, bond and window sit in the countersigned terms, and a default or dispute pays amount + bond.
   - This happens after the project lead's re-audit of the branch.
   - Then run one bonded job on Arc where `failDelivery` pays the buyer, and put its tx in docs/proof.md.
   - Deploy by forge. The Studio story is out of the pitch (item 5).
4. **Hedera scheduled checkout becomes the default Hedera path (target 00:30, hard limit 01:45). Owner: cs-hd.**
   - The payment is held until the seller signs, so a failed delivery no longer loses the buyer's money. A live tx proves the old behaviour.
   - The judge names this as the single biggest flip of the verdict.
5. **Dropped, effective now:**
   - the per-call approval path: `HUMAN_APPROVAL_TOKEN` and v2 decisions (cs-ui stops);
   - the Arc mobile consumer track;
   - the Arc Studio track in the pitch (cs-readme takes them out of the pitch);
   - further landing polish. PR #136 merges as built and nothing more.
6. **The demo is fixed. Record it tonight, while everything is live.**
   - **The scene:** kill the hub on stage, run the verifier on a real slip, print VALID with the Released hash matching, and say "one signature, six terms, change a byte and the chain refuses it".
   - **Script by 20:30, owner orch-cs:** the exact commands, against today's live Arc v1 slip. The firstmate records the screen with the project lead.
   - **Owner cs-readme:** docs/status.md is linked at the top of the README and in the submission text. The judge called it the most credible artefact in the repo.

**The 22:00 hard freeze is lifted** for items 3 and 4 only. Nothing else new starts.
