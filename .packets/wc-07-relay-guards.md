# wc-07 — relay: never release a zero slip hash; Ankr RPC first

Issue: #37 (on-chain slip hash: never zero) and #10 (Whitechain rail).

## Goal

Two small changes to `packages/relay`, plus the matching default in the whitechain rail.

1. **Never release a zero slip hash.** The relay refuses a release whose `slipHash` is `0x000…000`, before it simulates or spends anything. The hub already refuses to release with a zero hash. The relay is the last stop before chain 1874, so it refuses too.
2. **Ankr RPC first.** The relay reads and writes chain 1874 through `https://rpc.ankr.com/whitechain_testnet` first. It falls back to `https://rpc.testnet.whitechain.io` (with a dot) when Ankr fails. Never use `https://rpc-testnet.whitechain.io` (with a hyphen): that is a different chain, 2625. The whitechain rail's default RPC becomes Ankr too.

## Lease

- `packages/relay/src/escrow-ops.ts`
- `packages/relay/src/chain.ts`
- `packages/relay/src/config.ts`
- `packages/relay/src/server.ts`
- `packages/relay/test/**`
- `packages/rail/src/whitechain/index.ts`
- `packages/rail/test/whitechain.test.ts`

Touch nothing else. View code is out of bounds: nothing under `apps/web`. Never commit `bun.lock`; run `git checkout -- bun.lock` before every commit.

## Context

- `packages/relay/src/escrow-ops.ts`: `releaseJob({ jobId, slipHash, sellerSig })`.
- `packages/relay/src/server.ts`: `POST /escrow/release` and the `import.meta.main` wiring of the viem clients. Keep the startup block last in the file. It must run after every module-level binding.
- `packages/relay/src/config.ts`: `WHITECHAIN_RPC_URL`.
- `packages/relay/src/chain.ts`: `WHITECHAIN_RPC_URL`, `whitechainSepolia`.
- `packages/rail/src/whitechain/index.ts`: `whitechainRail({ relayUrl, rpcUrl? })`.

## What to build

1. **Zero slip hash.** In `escrow-ops.ts`, `releaseJob` returns `{ ok: false, reason: "zero_slip_hash" }` when `slipHash` is 32 zero bytes, in any letter case. This happens before any ledger or chain call. `POST /escrow/release` answers it with 422. Tests:
   - zero is refused with no write and no simulation;
   - a non-zero hash still releases;
   - the route returns 422 `zero_slip_hash`.

2. **RPC order.**
   - **`chain.ts`:** export `WHITECHAIN_RPC_URLS = ["https://rpc.ankr.com/whitechain_testnet", "https://rpc.testnet.whitechain.io"]`. Keep `WHITECHAIN_RPC_URL` as the first entry.
   - **`config.ts`:** `rpcUrls` comes from `WHITECHAIN_RPC_URLS` (comma separated) when set, else `WHITECHAIN_RPC_URL` (single) when set, else the default list. Refuse any URL whose host is `rpc-testnet.whitechain.io`, with an error that says it is chain 2625.
   - **`server.ts`:** build both the public and wallet clients on viem's `fallback(rpcUrls.map((url) => http(url)))`. At startup, check `eth_chainId` on every URL and refuse to start if any one is not 1874, naming that URL in the error.

   Tests:
   - the config default order;
   - an env override;
   - the refusal of the 2625 host.

3. **Rail default.** In `packages/rail/src/whitechain/index.ts` the default `rpcUrl` becomes `https://rpc.ankr.com/whitechain_testnet`. Update its test.

## Constraints

- **No browser of any kind on this machine.** No headless Chrome, Playwright, Puppeteer or screenshot tools. Verify with tests and `curl` only.
- No network in tests.
- Never log keys or signatures.
- Small present-tense commits, no emoji, no `Co-authored-by`. End each commit message with `refs #37` or `refs #10`.
- Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green from the worktree root.

## Stop conditions

- A change is needed outside the lease.
- A failure survives three different fixes.
- 60 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-07-relay-guards.md`: what changed, test counts and any deviations.
