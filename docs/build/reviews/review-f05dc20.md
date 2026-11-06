> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review f05dc20 (cs/cs-06, PR 36) — discovery: Bazaar list, 402 extension, A2A card, skills index, OpenAPI
Result: **blockers=0 should-fix=2**. `bun test apps/hub/test/discovery.test.ts` 8/8.
Should-fix:
1. **One bad offer takes down the whole discovery list.** `itemFor` calls `rail.challenge` for every listed offer with no guard, and `challenge` throws for some valid listings (the Hedera rail throws when the offer has no `payTo.hedera` or no facilitator is active). I confirmed it with a probe: a rail whose `challenge` throws makes `listResources` throw, so `/discovery/resources` returns an error for everyone. Catch per offer and skip it (or list it without that rail). The 402 path in `call.ts` has the same shape for a single offer; there it fails one call, here it fails the index.
2. **The A2A card and skills index list offers with no online or seller check.** Delisted offers are excluded, but an offline seller's offer is advertised and the buyer finds out at call time. Acceptable for the demo; filter on `online` if discovery is meant to be a promise.
Held: delisted offers are excluded; `limit` is clamped to 1..200 and negative or non-numeric `offset` falls back to 0; nothing from the runner link, store internals or keys appears in the metadata; the 402 builder moved to a shared helper without changing what the buyer signs.
