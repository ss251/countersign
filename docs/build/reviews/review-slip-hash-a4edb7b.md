> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Pre-review of the on-chain slip hash against cs/int a4edb7b

Reviewer: cs-w1. The approved design (release commits the body hash, verifier compares `Released.slipHash`) is queued as a packet; this is an attack on what is on cs/int today so the packet has tests to pass. Result: **blockers=2 should-fix=3**. Tests: `packages/verify/test/w1-attacks.test.ts` and `packages/rail/test/w1-attacks.test.ts` on `cs/w1`.

## Blockers
**B7. The on-chain check does not bind the chain.** `checkOnchain` builds a public client from the RPC URL and never reads `eth_chainId`. A node on any other chain (Whitechain 1874 where the slip says Arc, or a private chain that deployed a contract at the slip's escrow address and emits a matching `Released`) satisfies the check. The slip names `body.chainId`; the check must read the node's chain id and fail unless it equals `body.chainId`. Test `B7: an RPC that answers as another chain cannot vouch for a slip` expects the `onchain` finding to fail, gets ok.
**B8. The release path can commit `bytes32(0)`.** `escrowRail().escrow.release` forwards whatever slipHash it is given. Test `B8: escrow.release with bytes32(0) is refused before anything is sent` expects `success:false` and no write; the write happens. The hub always passes `slip.hash` today, so this is a guard, not a live hole, but the project lead's rule is that the path never passes zero. orch-cs has this in its packet (1); this test is its acceptance.

## Attacked, held (tests pass on a4edb7b)
- Hub and verifier use one definition: `slipHash(body) = canonicalHash(body)` from core; the body has no settlement or receipt field, so release never waits on its own tx. Test `the committed hash does not move with the settlement receipt`.
- A tampered body with a self-consistent hash: the `hash` finding passes, the `onchain` finding fails because the chain holds the original hash (and the seller signature does not recover). Test `a tampered body whose own hash is self-consistent fails the chain check`.
- A `Released` log carrying another slip hash does not vouch for this slip.
- Reuse: the log must match jobId and slipHash and come from the slip's escrow address; a hash cannot be replayed across jobs because the jobId is inside the hashed body.

## Should-fix
1. **The CLI prints `VALID` when the on-chain check was skipped** (no `--rpc`). The `skip` line is printed, but the verdict is the same word. With the chain proof being the point, print `VALID (offline: chain not checked)` or exit non-zero unless `--offline` is given.
2. **The verifier trusts `body.escrow`.** A seller can fabricate a slip naming its own contract that emits `Released`. Pin `(chainId, escrow)` to the known deployments, as the buyer does with `KNOWN_RAILS`; unknown escrows verify as `unknown rail`, not as proof.
3. **`children` is unauthenticated in the hash.** The root commits whatever child hashes the seller lists; the verifier does not fetch or check them. Fine for the demo, but the tree view must not imply the children were verified.
