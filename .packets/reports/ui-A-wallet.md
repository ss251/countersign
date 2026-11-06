# ui-A-wallet — report

## What shipped

The shell now carries a visible wallet control, and every buyer action that needs a signature says so.

- **Two chains in `apps/web/src/lib/wallet.ts`**, built with viem's `defineChain`: Arc testnet (`5042002`, USDC, `https://rpc.testnet.arc.network`, Arcscan) and Whitechain testnet (`1874`, WBT, `https://rpc.testnet.whitechain.io`).
- **One connector:** `walletConfig` is `createConfig` with `injected()` only and `multiInjectedProviderDiscovery: false`; Arc is the first chain. `chainName` names the two known chains, falls back to `chain <id>`, and returns `""` for `undefined`; `shortAddress` reuses `shortHex`.
- **`Providers`** wraps the app in `WagmiProvider` and one module-level `QueryClientProvider`, rendered inside `StrictMode` from `main.tsx`.
- **`WalletButton`** in `TopBar` (between the nav and the mobile Views button) and again in the mobile sheet after the links:
  - no injected provider: "No wallet in this browser" plus a "Get one" link to MetaMask;
  - disconnected: "Connect wallet" through `connectors[0]`; while connecting the same button is disabled and reads "Connecting";
  - connected: short address in mono, ` · `, the chain name, then a quiet "Disconnect";
  - connected elsewhere: the same line with `chain <id>` and a "Switch to Arc testnet" button;
  - a connect or switch error renders one `role="status"` line, "The wallet did not connect: …", cleared on the next attempt.
- **`NeedsSignature`** sits under the assistant's `HoldToSign`: off-chain it offers "To sign in this browser instead, connect a wallet." with a Connect wallet button; connected it names the short address and chain.
- **Copy fixes in the purchase card:** the hold now says it signs nothing and the agent countersigns when it runs the command; the post-hold title reads "Ready for {agent}. Run this on its machine to countersign:".

No blue was added. No WalletConnect, Coinbase SDK, Privy, secrets or `VITE_*` variables were introduced, and the landing was untouched.

## Files changed (all inside the lease)

- `apps/web/package.json`, `bun.lock` — `wagmi@^2`, `@tanstack/react-query@^5`.
- `apps/web/src/lib/wallet.ts` (new) — chains, config, `chainName`, `shortAddress`.
- `apps/web/src/app/Providers.tsx` (new) — wagmi and query providers.
- `apps/web/src/main.tsx` — renders `Providers` around `App`.
- `apps/web/src/ui/WalletButton.tsx` (new) — the connect/address/switch/disconnect control.
- `apps/web/src/app/App.tsx` — `WalletButton` in the top bar and the mobile sheet.
- `apps/web/src/app/shell.css` — the wallet block under `/* The wallet: connect, who and which chain. */`.
- `apps/web/src/ui/NeedsSignature.tsx` (new) — the signature-needed line for the purchase card.
- `apps/web/src/routes/assistant/Assistant.tsx` — the two copy changes and `NeedsSignature` under the hold.
- `apps/web/src/routes/assistant/assistant.css` — `.needs-sig`.
- `apps/web/test/wallet.test.ts` (new) — chain names, single injected connector, chain ids, and `shortAddress`.
- `.packets/reports/ui-A-wallet.md` — this report.

## Verification

From the worktree root, exactly the acceptance chain:

```
bun install                                          # no changes
bun run typecheck                                    # pass
bun test apps/web/test                               # 146 pass, 3 skip, 0 fail
(cd apps/web && bunx --bun vite build)               # pass
```

The 3 skips are the pre-existing live-chain suite in `apps/web/test/onchain.live.test.ts`, gated on `CS_LIVE=1`.

No browser of any kind was launched; the UI check goes back to the lane. The Vite build prints the usual `node:worker_threads` externalization note from viem's bundled `ox` chain data; it does not fail the build.
