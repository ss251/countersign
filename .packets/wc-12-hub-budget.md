# wc-12: the relay's arbiter calls get their own budget

Issue: #98. This fixes cs-audit's Medium on #164 `52b7c7c` (20:16Z): the relay's spend ceiling lets an attacker control the arbiter's liveness on 1874.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/int`, which carries #198.

## What happens now

- **The relay is 1874's arbiter.** On escrow v2 only the arbiter may release, and only it may call `failDelivery`. The relay makes both calls on the hub's word: the hub's bearer token, #198.
- **But each call is charged to the job's buyer.** `escrow-ops.ts` `close()` calls `relayer.submit(call, known?.buyer ?? escrow)`. The shared `SpendCeiling` refuses past:
  - `RELAY_MAX_TX_PER_PAYER_PER_HOUR`, default 30;
  - `RELAY_MAX_TX_PER_HOUR`, default 200;
  - `RELAY_CAP_WEI_PER_HOUR`, default 0.05 WBT.
- **So a buyer can block the hub.**
  - **One job:** the buyer fills its own quota with small payments to the merchant, about 29 × 0.01 USDT. The hub's release of that buyer's job is then refused, the job defaults, and on a bonded job the buyer gets price plus bond.
  - **Every job:** a few addresses fill the shared caps, and every hub release on 1874 is refused for an hour.

## Decisions

1. **A second ceiling for the hub (`config.ts`).**
   - Add `hubCeiling: SpendCeilingConfig` to the relay config, built like `ceiling`, with these values:

     | Field | Source | Default |
     |---|---|---|
     | `capWei` | `RELAY_HUB_CAP_WEI_PER_HOUR` | the shared `capWei` |
     | `maxTx` | `RELAY_HUB_MAX_TX_PER_HOUR` | 200 |
     | `maxTxPerPayer` | equal to its `maxTx` | |

   - Every other field is the same as the shared ceiling's.
2. **The relayer takes both (`relayer.ts`).**
   - The relayer gets an optional `hubCeiling: SpendCeiling`.
   - `submit(call, payer, opts?: { hub?: boolean })` reserves on `hubCeiling` when `opts.hub` is true and a hub ceiling exists, and on the shared ceiling otherwise.
   - Cancel and settle use the same ceiling the ticket came from.
   - `status()` adds `hubCeiling: <snapshot> | null`.
   - Nothing else in `submit` changes. In particular, the balance floor and the simulation apply to hub calls exactly as before.
3. **The hub's calls use it (`escrow-ops.ts` and `server.ts`).**
   - **Releases:** `releaseJob(input, ctx, opts?: { fromHub?: boolean })`. A release on a v2 job that came with the hub bearer submits with `{ hub: true }`, and payer `"hub"`.
   - **failDelivery:** `failDeliveryJob` always submits with `{ hub: true }`. Its route already requires the bearer.
   - **v1 releases:** unchanged; they are charged to the buyer on the shared ceiling, as today.
   - **`server.ts`:** `/escrow/release` passes `fromHub` (the value its gate already computes) into `releaseJob`. Build the hub `SpendCeiling` beside the shared one and give it to the relayer.
4. **Nothing else changes.** No route's answers change, and the `/settle` gates stay as they are.

## Tests (no network)

1. **A buyer that has used up its own per-payer quota** (30 entries charged to it) cannot block the hub's bearer release of its v2 job: the release submits.
2. **The shared hour's transaction cap is full:** the hub's bearer release still submits.
3. **The shared hour's WBT cap is full:** the hub's bearer release still submits.
4. **The hub budget is bounded.** With `RELAY_HUB_MAX_TX_PER_HOUR=1`, a second hub release within the hour is refused as `ceiling_tx`, and nothing is sent.
5. **`failDelivery`** is reserved on the hub ceiling.
6. **A v1 release** is still reserved on the shared ceiling, charged to the buyer.
7. **`/status`** shows `hubCeiling` beside `ceiling`.
8. **Config:** both new variables parse, and their defaults are as stated.
9. **Existing tests:** every one passes **unedited**.

## Lease

- `packages/relay/src/config.ts`
- `packages/relay/src/relayer.ts`
- `packages/relay/src/escrow-ops.ts`
- `packages/relay/src/server.ts`
- `packages/relay/test/*`: new tests only.

Touch nothing else, and leave `ceiling.ts` unchanged. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #98`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `.packets/reports/wc-12-hub-budget.md` in your worktree and commit it, saying what changed and what each new test proves.
