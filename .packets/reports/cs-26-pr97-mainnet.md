# cs-26-pr97-mainnet report: the guard's rail switches and the ERC-8004 read race

Branch: `cs/97-mainnet` (aa8ef17 + cs/int 6b196c2). No test under `test/` was edited.
The only test added is `apps/hub/test/rails-switches.test.ts`, the one step (a) asks for.

## Step (a): what each switch was classified as

| Variable | Classification | Where it is listed | Mainnet entry |
| --- | --- | --- | --- |
| `HEDERA_SCHEDULED_RAIL` | rail switch, `'1'` starts rail `hedera-scheduled` | `RAIL_SWITCHES` (vars: `["HEDERA_SCHEDULED_RAIL"]`, testnet only, no secrets) | `"hedera-scheduled": { none: ... }` in `MainnetProfile` / `MAINNET`, enforced by `Record<SwitchedRail, object>` |
| `ARC_ESCROW_VERSION` | config, not a switch: selects Arc escrow version `1` or `2`, starts no rail | `RAIL_CONFIG_VARS`, beside `ARC_RPC_URL`, `ARC_USDC`, `CS_RELAYER_KEY` | none needed; it configures the escrow rail |

`railsFromEnv` now asks `railRequested("hedera-scheduled", env)` instead of reading the
variable directly, so the switch table is the one place that decides whether the rail
starts. The new test proves both halves: `railsFromEnv` builds the `hedera-scheduled`
rail when the variable is `1`, and `mainnetProblems`/`assertBootable` refuse a mainnet
hub that sets it (`Rail hedera-scheduled has no mainnet`), not the generic
`No rail is configured for mainnet.` the old guard returned. Dropping the held rail
from the switch table or its mainnet profile fails this test or the typecheck.

## Step (b): root cause

The failure was a **stale read of the chain height from viem's block-number cache**,
not a missing write and not the test.

What the evidence shows:

1. The failing tests await their own `giveFeedback` receipt (`status: "success"`,
   block 4 in the probe), so the log is mined before `readFeedback` runs.
2. In a failing run, a raw `eth_blockNumber` returned `0x4`, while
   `readFeedback`'s `publicClient.getBlockNumber()` returned `0`, `1` or `3`.
   `getLogs` therefore scanned `0..stale` and never reached the feedback's block,
   returning 0 entries.
3. viem's `getBlockNumber` wraps the RPC in `withCache` with
   `cacheTime = client.cacheTime` (4000 ms for this client). `waitForTransactionReceipt`
   starts `watchBlockNumber`, which calls `getBlockNumber({ cacheTime: 0 })`.
   `withCache` ignores `cacheTime` when *writing*: it stores the response anyway. That
   call runs before the transaction of interest is mined, so it caches a pre-write
   height. The next default-cache read (inside `readFeedback`) returns it for up to
   four seconds.
4. The probe's RPC trace pinned the seeding call inside the first deploy's
   `waitForTransactionReceipt` (`eth_getTransactionReceipt` -> `eth_blockNumber=0x1`),
   with `readFeedback` issuing no `eth_blockNumber` call at all.

Reproduction: 7/30 probe iterations failed before the fix, 0/40 after.

Fix, in `packages/identity/src/erc8004.ts`: `readFeedback` reads the height with
`getBlockNumber({ cacheTime: 0 })`, so it always asks the node after the caller has
awaited its write. No test change; both tests now read the same chain height the
receipt names.

## 20-run counts

`bun test packages/identity/test/erc8004.test.ts`, on `main` at 0e53253 (`/tmp/cs26-main`):

| Placement | Pass | Fail |
| --- | --- | --- |
| Alone, 20 runs | 18 | 2 |
| Under load (full `bun test` in parallel), 20 runs | 16 | 4 |

After the fix, on `cs/97-mainnet`:

| Placement | Pass | Fail |
| --- | --- | --- |
| Alone, 20 runs | 20 | 0 |
| Under load (full `bun test` in parallel), 20 runs | 20 | 0 |

Failing before-runs reported `Expected length: 1, Received length: 0` for
"feedback built from a released slip is readable" and for the earned-feedback test
that reads the same list.

## Acceptance

From the worktree root, after the changes:

```
bun install && bun run typecheck && bun test apps/hub packages/identity && bun test && forge test
```

All commands exit 0: hub+identity 176 pass / 0 fail, full suite 1109 pass / 3 skip /
0 fail, forge 47 pass / 0 fail.
