# cs-11-front-door — hub endpoints for the front door: offer search, sellers, recent settlements

## Setup

Run `bun install` at the worktree root before anything else.

## Goal

The public console's front door needs three read-only hub endpoints. It needs no view code: cs-ui builds the screens.

1. **Offer search** for the assistant: a text query returns ranked offers, each with the reasons it matched.
2. **Sellers** for the registry: each seller with their payees, offers, slip-derived counts and, when one exists, their ERC-8004 agent id.
3. **Recent settlements** for the overview: rail, amount and explorer link, newest first.

## Lease

You may create or change only these paths:

- `apps/hub/src/frontdoor.ts` (new) and `apps/hub/src/identity.ts` (new)
- `apps/hub/src/store.ts`: add read-only query methods only, without changing existing ones
- `apps/hub/src/app.ts`: register the routes, and pass any new option through `HubDeps`
- `apps/hub/test/frontdoor.test.ts` (new)
- `.packets/reports/cs-11-front-door.md`

Do not edit any `package.json`, `bun.lock`, `packages/**`, other hub files or anything else.

## Read first

`apps/hub/src/app.ts`, `apps/hub/src/store.ts` (tables `offers`, `jobs`, `slips`), `apps/hub/src/discovery.ts`, `packages/core/src/types.ts` (`Offer` and `Slip`), and the existing hub tests and harness in `apps/hub/test/`.

## What to build

All routes are GET, CORS-open like the rest, and return JSON. Amounts stay atomic digit strings. Every endpoint returns an honest empty list when there is no data, never a fixture.

1. `GET /search?q=<text>&limit=<1..50, default 10>&rail=<rail id, optional>&maxPrice=<atomic, optional>`. The response is `{query, results: [{offerHash, offer, online, score, reasons}]}`.
   - Tokenise `q` in lowercase on non-alphanumerics and drop tokens shorter than 2 characters.
   - Score each listed (not delisted) offer:
     - title token match +3 each;
     - summary match +1;
     - adapter name match +2;
     - upstream URL match +1;
     - a property name in `offer.input.properties` or `offer.output.properties` +2;
     - online +1.
   - `reasons` holds a short plain sentence per contribution, for example `title has "arc"`, `takes "question"`, `served by a skill`, `seller is online`. List each reason once.
   - Drop offers with score 0. Apply the `rail` and `maxPrice` filters. Sort by score descending, then price ascending, then newest.
   - An empty or missing `q` returns `{query: "", results: []}` with status 200, never an error.
2. `GET /sellers`. The response is `{sellers: [{seller, payees, offers, counts, volume, identity}]}`, one entry per distinct `offer.seller` among listed offers:
   - `payees` is the union of `offer.payTo` across that seller's offers, as an object keyed by rail;
   - `offers` is `[{offerHash, title, price, rails, online}]`;
   - `counts` is `{calls, released, settled, refunded, failed}`, derived from the `jobs` table for that seller's offers. `released` and `settled` must match stored slips;
   - `volume` is `{released}`, the sum of released or settled job amounts in atomic units, as a string;
   - `identity` is `{registry, agentId}` or `null` (see 4).

   Sort by `released` count descending, then by offer count.
3. `GET /settlements/recent?limit=<1..100, default 20>`. The response is `{settlements: [...]}`, built from the `slips` table newest first. Each entry is `{slipHash, jobId, offerHash, title, rail, network, amount, asset, payTo, seller, buyer, deliveredAt, transaction, url}`:
   - `url` is the slip's `settlement.url` when present, otherwise `null`;
   - `title` is the offer's title when the offer is known.
4. Identity, `apps/hub/src/identity.ts`, is `sellerIdentity(seller): Promise<{registry, agentId} | null>`, optional and injected:
   - `HubDeps` gains `identity?: (seller: string) => Promise<{registry: string; agentId: string} | null>`. When it is absent, `identity` is `null` for every seller.
   - Export a factory `erc8004IdentityLookup({rpcUrl, registry, fromBlock})`. It reads `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` logs from the registry, filtered on the indexed `owner` topic equal to the seller, in windows of 10,000 blocks from `fromBlock`, and returns the newest `agentId` as a decimal string.
   - Cache each result for 10 minutes. Treat any RPC error as `null` and never fail the request.
   - Wire nothing to the network in tests.

## Tests (`apps/hub/test/frontdoor.test.ts`), using the existing harness

- Search:
  - ranks a title match above a summary-only match;
  - `reasons` names the matched tokens;
  - the `rail` filter drops offers without that rail;
  - `maxPrice` drops dearer offers;
  - a delisted offer never appears;
  - an empty `q` gives 200 with no results.
- Sellers: two sellers with offers, one released job (stored slip), one refunded job and one failed job give the right counts and volume. The injected identity function's value appears, and `null` appears without it.
- Settlements: after two paid calls through a FakeRail (the existing harness), the list holds both newest first, with `rail`, `amount` and `url`. An empty hub returns `{settlements: []}`.
- Identity: `erc8004IdentityLookup` with a fake client returns the newest `agentId` for the owner, `null` when there are none, and `null` on an RPC error.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. TypeScript strict, no `any`. Read-only: these routes never write.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/hub && bun test && forge test
```

Every command passes, with no skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages, and no trailers. Write `.packets/reports/cs-11-front-door.md`. Do not push, merge or deploy.
