> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review cb84b20 (cs/91-ens, #28): PR 91's ENS payee lock with B13 fixed, merged over cs/int

Reviewer: cs-w1. Result: **blockers=0 should-fix=3**. The three should-fixes are the ones from the 12:14Z review of 8db3426, which still stand, and none of them blocks the merge.

## B13: closed
ba6d6c2 is the fix verbatim. In `packages/core/src/ens.ts`, the Sepolia client is created with `ccipRead: false`, so an `OffchainLookup` fails closed as `ens-unresolved`, and the hub never fetches a URL the name's owner chose. `packages/core/test/w1-ens.test.ts` passes. Core, hub and buyer give 339 pass and 0 fail on cb84b20.

## The merge, as asked
1. **`buy.ts`, both checks inside cs/int's router flow.**
   - `checkEnsLock(offer, a.ens)` runs right after the delisted and online checks, before the input check and before any 402. The name is resolved on the buyer's side, never taken from the hub, and a failed lock journals a refusal.
   - The payee-versus-name check runs after the entry is chosen and right before the rail is fixed. An EVM `payTo` that is not the name's address is refused, and nothing is signed.
2. **`apps/hub/src/index.ts`** builds `sepoliaEnsResolver` (with an optional `HUB_ENS_RPC_URL`) and passes `ens` into `createHub`, beside `humanApprovalToken`, `relayUrl` and `identity`.

## Still open from 8db3426 (should-fix)
1. **One RPC decides what a name resolves to,** for the hub and for the buyer. Let the buyer pin its own, and ideally require two endpoints to agree before paying a named seller.
2. **A name that stops resolving is only hidden at call time, not refused.** The hub's call path should refuse a named offer whose name no longer resolves.
3. **Non-EVM payees are outside the lock** (`isAddress` skips Hedera `0.0.N`). Say so wherever the name is shown.
