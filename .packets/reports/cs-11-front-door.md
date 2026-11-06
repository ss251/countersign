# cs-11-front-door report

Date: 2026-11-06
Branch: `cs/cs-11`

## Landed

### Search — `GET /offers/search`

- Registered before `GET /offers/:offerHash`, so `search` is never read as an offer hash.
- Lowercases `q`, splits on non-alphanumerics, drops tokens shorter than two characters and repeated tokens.
- Scores listed offers only: title `+3` per token, summary `+1`, adapter `+2`, upstream URL `+1`, input/output property name `+2`, online `+1`.
- `why` lists one sentence per contribution (`title has "arc"`, `takes "question"`, `served by a skill`, `seller is online`).
- Applies `rail` and `maxPrice`, drops score 0, sorts by score, atomic price, newest, then hash, and clamps `limit` to 1..50 (default 10).
- Missing, empty or punctuation-only `q` returns `200 {query: "", results: []}`.

### Sellers — `GET /sellers`

- One entry per distinct seller among listed offers, with `name: null`.
- `payees` is the union of `offer.payTo` keyed by rail across that seller's listed offers.
- `offers` carries hash, title, price, rails and online state.
- Counts come from the seller's jobs. `released` and `settled` only count when the job's slip is actually stored; `volume` sums those same amounts as atomic strings.
- Sorts by `released` descending, then offer count.
- `erc8004` comes from the injected `HubDeps.identity` lookup, or is `null` for every seller when none is injected.

### Settlements — `GET /settlements`

- Returns released, settled and refunded jobs with a close transaction, newest close first, `limit` clamped to 1..100 (default 20).
- Each entry has `jobId`, `offerHash`, title, seller, buyer, amount, asset, rail, network, kind, tx, explorer, slipHash and `at`.
- Explorer is the slip's settlement URL when a slip exists, otherwise the rail's `explorerTx` template filled with `tx`; `null` when the template is empty.
- `slipHash` is `null` for refunds; `at` is `closed_at` with `created_at` as the fallback.

### Store

- Added nullable `closed_at` to `jobs`, including an in-place `ALTER TABLE` for existing databases.
- `closed_at` is set whenever `close_tx` is set: `updateJob` writes the current unix second when no explicit time is supplied, and direct inserts use the supplied `closedAt` or `created_at`.
- Added read-only `listJobs()` and `listClosedJobs(limit)`. Existing methods keep their behaviour.

### Identity

- `apps/hub/src/identity.ts` exports `erc8004IdentityLookup({rpcUrl, registry, fromBlock})`.
- Scans `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` logs in 10,000-block windows from `fromBlock`, filtered by the indexed owner topic.
- Returns the newest registration's `agentId` as a decimal string, caches each seller for ten minutes, and turns any RPC error into `null`.
- An optional `client` seam lets tests run without any network.

## Tests

`apps/hub/test/frontdoor.test.ts` covers:

- search route precedence, title-over-summary ranking, `why` sentences, rail and max-price filters, delisted exclusion, empty query;
- two sellers, payee unions, offer lists, released/refunded/failed counts, slip-backed volume, injected identity and the no-identity null;
- two paid calls on different rails plus a janitor refund, ordering, kind, rail, amount, explorer, slip hashes and the empty hub;
- identity lookup with windows, newest log, no registration, RPC failure and ten-minute cache.

No browser, Playwright, Puppeteer or screenshot tool was launched. No live RPC or chain call was made in tests.

## Acceptance

From the worktree root:

```
$ bun install
Checked 159 installs across 180 packages (no changes) [6.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json
(no output; exit 0)

$ bun test apps/hub
 39 pass
 0 fail
 278 expect() calls
Ran 39 tests across 5 files. [539.00ms]

$ bun test
 245 pass
 3 skip
 0 fail
 902 expect() calls
Ran 248 tests across 35 files. [6.86s]

$ forge test
Ran 3 test suites in 154.71ms (122.62ms CPU time): 29 tests passed, 0 failed, 0 skipped (29 total tests)
```

The three skips are the pre-existing `apps/web/test/onchain.live.test.ts` suite, gated by `CS_LIVE=1`; this packet added no skips.

## Not done

Nothing in the packet was left undone. No pushes, merges or deploys.
