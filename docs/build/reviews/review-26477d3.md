> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 26477d3 (PR 155, TheRealRajdeep, #28 follow-up): ENS endpoints agree, call-time refusal, seller card

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This closes the three ENS should-fixes from 8db3426 and cb84b20.

Core, hub ENS and buyer tests give 225 pass and 0 fail on 26477d3. `packages/core/test/w1-ens.test.ts` keeps my assertion that no gateway URL is fetched, and adds that the name resolves to `null`. That makes it stronger.

1. **No single RPC decides a name.**
   - `sepoliaEnsResolver` asks every endpoint it is given, and throws unless all agree, both on "no address" and on the address. By default these are two independent public Sepolia endpoints.
   - A failed lookup refuses the named offer, so it fails closed.
   - The hub and the buyer each pin their own list (`HUB_ENS_RPC_URLS`, `CS_ENS_RPC_URLS`).
   - CCIP-Read stays off, and an `OffchainLookup` answer counts as unresolved.
2. **A re-pointed name is refused at call time.** `paidCall` re-checks the lock before any 402 or payment: 409, or 503 when the lookups are unavailable, with "Nothing was charged".
3. **The seller card** says what a name does not cover: non-EVM payees.
