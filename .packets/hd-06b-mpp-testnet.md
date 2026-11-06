# hd-06b-mpp-testnet: the MPP rail's stablecoin method is testnet-only

## Goal

Review of hd-06 found that the rail's Tempo (stablecoin) method points at **Tempo mainnet**: `TEMPO_USDC` is mainnet USDC.e, and the challenge uses the mainnet chain. A client with funds that paid one of our stablecoin challenges would send real money, to the placeholder recipient. Make the Tempo method testnet-only, on Moderato (chain 42431), and make it impossible to configure mainnet. Document how to run `mppx validate` safely on this machine. This is the one corrective packet for hd-06. Tracked by issue #5.

## Lease

- `packages/rail/src/mpp/**` and `docs/mpp.md`.
- `scripts/mpp/server.ts`, only if it needs a change for the above.
- Report: `$M/reports/hd-06b-mpp-testnet.md`.

## Context

- `packages/rail/src/mpp/constants.ts`, `rail.ts`, `test/rail.test.ts` and `docs/mpp.md` on this branch.
- mppx 0.17.1:
  - `node_modules/mppx/dist/tempo/internal/defaults.d.ts`: `chainId.testnet = 42431`, `chainId.mainnet = 4217`, and testnet default currency `0x20c0000000000000000000000000000000000000` (pathUSD);
  - `dist/tempo/server/Charge.d.ts`: its `testnet` option, plus `chainId` and `currency`.
- The report from hd-06: `$M/reports/hd-06-mpp-rail.md`.

## Required

1. **Pin the chain.** The Tempo method is created for Moderato only: `testnet: true`, chain id 42431, and currency set to mppx's testnet default (pathUSD).
   - Remove the mainnet USDC.e constant.
   - No option or code path may produce chain 4217 or a mainnet currency address. If mppx is ever given a chain id, it is the testnet one, taken from mppx's own defaults.
2. **Declaration.** The asset is network `mpp:tempo`, address = the testnet currency, symbol `pathUSD`, decimals 6. The floor stays 0.01 in USD stablecoin units.
3. **Tests:**
   - the Tempo challenge, decoded from `extra.mpp.wwwAuthenticate`, carries chain id 42431 and the testnet currency;
   - a static guard reads every file under `packages/rail/src/mpp/` (tests excluded) and fails if it finds `4217` or the mainnet USDC.e address `0x20c000000000000000000000b9537d11c60e8b50`;
   - every existing test stays green.
4. **`docs/mpp.md`:**
   - state "testnet only: Tempo Moderato (chain 42431, pathUSD), Stripe test mode";
   - add a section, "Running `mppx validate` safely on this machine":
     - take the `stripe` CLI off `PATH` and unset `MPPX_STRIPE_SECRET_KEY` and `MPPX_STRIPE_SPT_URL`, because validate auto-discovers a Stripe key through the stripe CLI;
     - never pass `--yes`;
     - never run validate against a Tempo endpoint, because the validator resolves a local payer wallet and reads, or with `--yes` pays, on chain.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No keys. Never read an env file, a config directory or a CLI config.
- Network: the npm registry and localhost only. **Never run `mppx validate` against any Tempo endpoint, and never call any RPC.**
- Change nothing outside the lease. Never stage `bun.lock`.

## Acceptance

```
bun run typecheck && bun test packages/rail/src/mpp
# with the stripe CLI off PATH and MPPX_STRIPE_SECRET_KEY / MPPX_STRIPE_SPT_URL unset:
bun scripts/mpp/server.ts 8798 &   # card endpoint only
npx mppx@latest validate http://localhost:8798
```

The tests must pass with none skipped. Validate on the card endpoint must exit 0, as before. Paste its output in the report and stop the server afterwards. Commit on `cs/hd-06` with short present-tense messages ending `refs #5`, and no trailers.

## Stop conditions

- mppx cannot build a Tempo challenge pinned to testnet: stop, and report what it requires.
