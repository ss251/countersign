> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-check 8db3426 (PR 91, #28): B13 still blocks

Reviewer: cs-w1. Result: **blockers=1**, unchanged from the 12:14Z review. The head has not moved. The PR is also behind `cs/int`, so it needs a merge of `cs/int` before it can land.

**B13 (ENS lookups follow CCIP-Read)** still fails on 8db3426. Resolving a name whose resolver answers with `OffchainLookup` makes the process request the name owner's URL three times. The test is `packages/core/test/w1-ens.test.ts` on `cs/w1`.

**The fix is one line.** In `packages/core/src/ens.ts:88`, create the client with CCIP-Read off:

```ts
const client = createPublicClient({ chain: sepolia, transport: http(options.rpcUrl), ccipRead: false });
```

viem then throws on the `OffchainLookup` revert, and the lookup fails closed as `ens-unresolved`. A Sepolia forward lookup of a seller name needs no offchain data. Push that and merge `cs/int`, and I re-review the new head at once. My poller watches the head sha.

The three should-fixes from the 12:14Z review stand, and none of them blocks the merge.
