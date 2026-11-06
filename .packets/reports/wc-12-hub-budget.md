# wc-12: the relay's arbiter calls get their own budget

## What changed

### `packages/relay/src/config.ts`

`RelayConfig` gained `hubCeiling: SpendCeilingConfig`, built beside `ceiling`:

- `windowMs`: the same `HOUR_MS` as the shared ceiling.
- `capWei`: `RELAY_HUB_CAP_WEI_PER_HOUR`, defaulting to the shared `capWei`
  (0.05 WBT).
- `maxTx`: `RELAY_HUB_MAX_TX_PER_HOUR`, default 200.
- `maxTxPerPayer`: equal to its own `maxTx`, so it defaults to 200.

### `packages/relay/src/relayer.ts`

- The constructor takes an optional seventh argument, `hubCeiling?: SpendCeiling`,
  after the existing spend callback so existing construction sites are unchanged.
- `submit(call, payer, opts?: { hub?: boolean })` reserves on `hubCeiling` when
  `opts.hub` is true and a hub ceiling exists, and on the shared ceiling otherwise.
  The chosen ceiling is kept for the ticket's cancel and settle paths.
- `status()` reports `hubCeiling: CeilingSnapshot | null` beside `ceiling`.
- Nothing else in `submit` changed: the allowlist, simulation, fee check, balance
  floor, write and receipt handling are shared by both ceilings.

### `packages/relay/src/escrow-ops.ts`

- `releaseJob(input, ctx, opts?: { fromHub?: boolean })`. A release on a v2 job with
  `fromHub` true submits with `{ hub: true }` and payer `"hub"`. A v1 release ignores
  `fromHub` and stays on the shared ceiling charged to the buyer.
- `failDeliveryJob` always submits with `{ hub: true }` and payer `"hub"`; its route
  already requires the hub bearer.
- `acceptJob`, `disputeJob`, `releaseAfterWindowJob`, `cancelJob` and `refundJob` are
  unchanged.

### `packages/relay/src/server.ts`

- `/escrow/release` passes its already-computed `fromHub` into `releaseJob`.
- `/status` returns `hubCeiling` beside `ceiling` (`null` when the relayer has none).
- Startup builds `new SpendCeiling(config.hubCeiling)` beside the shared ceiling and
  passes it to the relayer.

`ceiling.ts` is untouched. No route's answers changed, and the `/settle` gates are as
they were.

## Tests and what they prove

New file `packages/relay/test/wc-12-hub-budget.test.ts`; the chain and relayer are
simulated, so no test reaches a network. Existing test files and helpers are unedited.

1. **A buyer at its per-payer quota cannot block the hub's v2 release.** The shared
   ceiling is seeded with 30 entries charged to the job's buyer (its
   `maxTxPerPayer`), and a direct reserve for that buyer is refused as
   `ceiling_payer`. The hub's bearer release still answers 200, writes `release` to
   the v2 escrow, leaves the shared count at 30, and adds one hub entry.
2. **A full shared transaction cap cannot block the hub's v2 release.** The shared
   ceiling has `maxTx: 2` and two seeded entries, so a reserve is refused as
   `ceiling_tx`; the hub release still answers 200 and adds one hub entry.
3. **A full shared WBT cap cannot block the hub's v2 release.** The shared ceiling's
   cap is 1000 wei and one seeded entry uses all of it, so a reserve is refused as
   `ceiling_wei`; the hub release still answers 200.
4. **The hub budget is bounded.** With `RELAY_HUB_MAX_TX_PER_HOUR=1` loaded through
   `loadRelayConfig`, the first hub release succeeds; a second release inside the
   hour answers 422 `{ ok: false, reason: "ceiling_tx" }`, sends no write, and leaves
   the job funded.
5. **`failDelivery` is reserved on the hub ceiling.** With the shared cap at 0, the
   `/escrow/fail` route still answers 200 through the hub bearer, writes
   `failDelivery` to v2, records one hub entry and no shared entry. A direct
   `failDeliveryJob` call proves the same without the route.
6. **A v1 release is still reserved on the shared ceiling, charged to the buyer.**
   With `maxTxPerPayer: 1`, a v1 release with the hub bearer answers 200, records one
   shared entry on v1 and no hub entry; a later reserve for the buyer is refused as
   `ceiling_payer`, while another payer can still reserve.
7. **`/status` shows `hubCeiling` beside `ceiling`.** The route returns a hub
   snapshot with the expected cap and transaction count, and returns `hubCeiling:
   null` for a relayer built without one.
8. **Config defaults and parsing.** The hub default is the shared cap
   (50,000,000,000,000,000 wei), `maxTx` 200 and `maxTxPerPayer` 200;
   `RELAY_HUB_CAP_WEI_PER_HOUR` and `RELAY_HUB_MAX_TX_PER_HOUR` parse; and the hub cap
   follows `RELAY_CAP_WEI_PER_HOUR` when it is not set explicitly.
9. **Existing tests.** The full suite passes unedited.

## Acceptance

```
$ bun install --linker hoisted
+ @countersign/relay@workspace:packages/relay
3 packages installed [472.00ms]

$ bun run typecheck
$ tsc -p tsconfig.json

$ bun test
 1586 pass
 5 skip
 0 fail
 6441 expect() calls
Ran 1591 tests across 213 files.

$ forge test
Ran 10 test suites: 100 tests passed, 0 failed, 0 skipped
```

Only the lease files changed. `bun.lock` was not committed.
