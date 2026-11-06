> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 8db3426 (PR 91, TheRealRajdeep) — ENS seller names on Sepolia lock the payee
Reviewer: cs-w1. Result: **blockers=1 should-fix=3**. Test: `W1 B13` in `packages/core/test/w1-ens.test.ts` on `cs/w1` (31c99c5); it fails, and the PR's own tests pass. No dependency, script or lockfile changes in the diff.

## Blocker
**B13. Resolving a seller's ENS name makes the hub fetch a URL the name's owner chose (SSRF).** `sepoliaEnsResolver` builds a viem client with its defaults, and viem follows CCIP-Read (EIP-3668). The hub resolves the name in `POST /offers`, before the offer is stored, for any key that can sign an offer. Anyone can set an ENS name's resolver to a contract that reverts with `OffchainLookup(sender, urls, ...)`; viem then requests each URL with the name's data, from the hub. A URL such as a cloud metadata address or an internal service is reached with no authentication. The buyer-side resolver has the same behaviour on the agent's machine. Test: a Sepolia RPC that answers the resolver call with an `OffchainLookup` naming `http://169.254.169.254/...`; resolving the name made the process request that URL (three requests seen), expected none. Fix: create the client with `ccipRead: false` (a Sepolia forward lookup for a seller name does not need offchain data), and treat a CCIP-Read answer as `ens-unresolved`.

## Should-fix
1. **One public RPC is the whole trust root.** The default Sepolia endpoint decides what a name resolves to, for the hub and for the buyer. A buyer whose RPC is wrong or hostile pays an address of the RPC's choosing, past the payee lock, because the lock compares against that same answer. Let the buyer pin its own RPC and, better, require two independent endpoints to agree before it pays a named seller.
2. **Lookup failure at publish time blocks the whole publish (503) but a failure at call time is a silent no-name.** That is the safe direction for the buyer; make the hub's call-time path refuse a named offer whose name stopped resolving, not only hide the name, since the hub still takes payment for it.
3. **Hedera and other non-EVM payees are outside the lock** (documented). An ENS-named seller can still point `payTo.hedera` anywhere. Say so next to the name wherever the UI shows it.

## Held
- The name is part of the hashed offer, so a hub cannot strip or change it (B6). Buyer: the name is resolved on the buyer's side, the seller must equal the answer, every EVM `payTo` must equal it, and the 402's payee is compared to it again before signing; any mismatch journals a refusal and signs nothing. An offer that names a seller with no resolver available is refused, not trusted.
- Only forward resolution is used and names must be in ENS normal form.
