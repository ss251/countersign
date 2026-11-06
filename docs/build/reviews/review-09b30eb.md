> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 09b30eb (PR 191, cs/ui-honest): the landing's escrow stages follow only a release an escrow contract held

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This fixes the firstmate's production FAIL from 16:07Z.

## Held
1. **Both escrow stages follow `escrowRelease`.**
   - That is the newest release on a rail that declares kind `escrow` and names a contract: Arc's escrow and Whitechain's.
   - Held Hedera declares kind `escrow` but no contract, and its seller's key can release alone (A4). Its releases, and every direct or batched payment, never stand under "until the output checks out".
   - With no rail declarations there is no claim. The stage says no escrow payment has cleared yet, or that the hub did not answer.
2. **Step 3 names this payment's own escrow, chain and explorer.**
   - The escrow comes from the seller's slip first, then from its own rail's declaration. The chain comes from its network, and the explorer from its rail's `explorerTx` or its network's template.
   - A Whitechain release names Whitechain's escrow on Whitechain's explorer, never Arc's. A record that names no escrow leaves the line out instead of borrowing another rail's contract.
3. **The other rails are said from their declarations.**
   - Direct and batched rails are listed as paying the seller before delivery.
   - Held Hedera gets A4's plain words: "Held Hedera waits for the seller's key, which can also release it without delivering."
   - A test checks that none of those lines claims escrow, a refund, or "until the output checks out".
4. **The Arc explorer stays valid.**
   - The hub declares `explorer.testnet.arc.io` for its Arc rails. That host is Arc's Blockscout explorer and answers 200, and `testnet.arcscan.app`, the old hard-coded host, redirects there with a 301.
   - So the switch from the hard-coded host to the declaration keeps every link live.
5. **Tests.**
   - The test files only gain lines: 101 added, none edited or removed.
   - On 09b30eb with a frozen install, `bun test apps/web` gives 160 pass, 0 fail and 3 skip (the CS_LIVE on-chain suite).
   - No lockfile or package.json change.

## Notes
1. **A1 is not done yet.** A1's done-when is the offer page: it renders each rail's terms from `/rails` and branches its copy per rail kind, with a test that an offer listing only gateway and hedera promises no escrow, refund or release gate. This PR fixes the landing only.
2. **Copy.** "Stripe MPP" for the `mpp` rail is loose: the rail settles on Tempo testnet through mppx, and Stripe is not in the payment path. "MPP on Tempo" says what happens.
