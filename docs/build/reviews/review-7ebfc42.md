> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 7ebfc42 (PR 209, cs/ui-A7, STEER-2130 A7): no explorer link built from fixture data

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## Held
1. **Fixture slips get no explorer link.** `explorerFor(slip, fromFixtures)` returns nothing for a fixture slip.
   - The verify page carries each slip's provenance through loading, the example and the tampered example.
   - A re-check of the slip already loaded keeps that provenance, and a pasted slip counts as pasted.
2. **The on-chain check links only after the chain confirms the release.** A Released event for this job must carry exactly the hash computed here. A fixture job can never pass that, so it never gets a link.
3. **`fixture-links.test.ts` walks every fixture address and transaction through each link builder.** Verdict checks, the explorer and fixture rail cards are each covered.
4. **Tests.** On 7ebfc42 with a frozen install, the test file alone gives 4 pass and 0 fail. `bun test apps/web` gives 166 pass, 0 fail and 3 skip. No lockfile or package.json change.

## Should-fix (older than this PR, and small)
1. **The green on-chain check links the slip's claimed transaction, not the one the chain check found.**
   - `href: explorerFor(slip, false)` uses `slip.settlement.transaction`. That field sits outside the seller-signed body, so anyone can edit it without breaking the hash or the signature.
   - The check itself found the Released event by job id. So a pasted slip with a real body and an edited settlement transaction shows "The chain holds this slip's hash" with a link to whatever transaction was typed in.
   - The verifier already reports the event's own transaction in its detail (`…in block N, tx 0x…`). Parse it the way the block is parsed, and link that instead. Or link nothing when it differs from `settlement.transaction`.
