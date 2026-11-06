# ui-A2-privy — report

## What shipped

The console now signs people in with email or a passkey through Privy, gets an embedded EVM wallet on Arc testnet, and keeps the injected browser wallet as the fallback.

- **Mode decision in `apps/web/src/lib/wallet.ts`:** `PRIVY_APP_ID` reads `VITE_PRIVY_APP_ID` at build time and trims it; `walletModeFor(appId, failed)` returns injected mode with the not-set-up line when there is no id, injected mode with the failure line when a failure is remembered, and Privy mode otherwise. `WalletMode`, the reason strings, `PRIVY_NOT_SET_UP` and `walletModeFor` are exported; the existing chains, config, `chainName` and `shortAddress` are unchanged.
- **Providers:** `WalletModeContext` and `useWalletMode()` sit in `apps/web/src/app/Providers.tsx`. Without an app id, or after a failure, the tree is ui-A's `WagmiProvider` → `QueryClientProvider` with the mode provided. With an id, the tree is `PrivyProvider` → `QueryClientProvider` → Privy's `WagmiProvider`, using `privyWagmiConfig` (same two chains and `http()` transports). Privy is configured with `loginMethods: ["email", "passkey", "wallet"]`, Ethereum embedded wallets `createOnLogin: "users-without-wallets"`, `defaultChain: arcTestnet` and `supportedChains: [arcTestnet, whitechainTestnet]`. No smart-wallet provider is installed or rendered.
- **Watchdog:** inside the Privy tree, `PrivyWatchdog` watches `usePrivy().ready`. If it is still false after 8 seconds it calls `onFail("Email sign-in did not start on this page, so connect a browser wallet.")`; the provider re-renders in injected mode and stores the line in `sessionStorage` under `countersign.privy-failed`. A stored failure is read on mount, so the tab stays on injected mode across reloads.
- **Connect menu:** disconnected, one `Connect` button (`wallet-menu`, `aria-expanded`) opens `.wallet__menu` with `role="menu"`. The options are an array: Privy mode offers `Sign in with email or passkey` (`wallet-signin`, `login()`) and `Connect a browser wallet` (`wallet-connect-injected`, `connectWallet()`); injected mode offers ui-A's injected connect and then `.wallet__why` (`wallet-fallback-reason`) with the mode's reason. With no injected provider, both modes replace the browser-wallet option with `No wallet in this browser · Get one`, linking to MetaMask. Escape or a click outside closes the menu.
- **Connected:** short address in mono (`wallet-address`), chain name (`wallet-chain`), `Switch to Arc testnet` when off both known chains, and `Disconnect` (`wallet-disconnect`). Privy mode calls `logout()` and then wagmi's `disconnect`; injected mode disconnects directly.
- **Styles:** `.wallet` is `position: relative`; `.wallet__menu` has the specified absolute grid, 16rem minimum, paper background and hairline border; menu items are full-width text buttons with 44 px targets; `.wallet__why` is slate at `var(--t-12)`. No blue.
- **Deploy:** `apps/web/deploy.sh` passes `VITE_PRIVY_APP_ID`, defaulting to the one Railway variable read with `railway variables --kv`; only that key is selected and nothing extra is printed.

## Dependency choice

`@privy-io/react-auth` is pinned to `3.6.1` and `@privy-io/wagmi` to `^4.0.20`. The newest react-auth (`3.51.3`) accepts wagmi 2 and React 19, but it depends on `x402@0.7.x`, which brings `@solana/kit@5`; under bun 1.3.14 that collides with the `@solana-program/system@0.16 → @solana/kit@8` peer already required by wagmi's Base Account connector, and the Vite build fails on `@solana/kit`'s missing `./program-client-core` export. `3.6.1` is the newest react-auth without the `x402` dependency; it still has everything the packet needs (React 19, passkey in `loginMethods`, `connectWallet`, `logout`, embedded Ethereum wallets, `defaultChain`/`supportedChains`) and its `@privy-io/wagmi` imports all resolve. Both builds pass with this pair.

Because `vite-env.d.ts` is outside the lease, it was not touched; Vite's `ImportMetaEnv` already has its default string index signature, so `import.meta.env.VITE_PRIVY_APP_ID` typechecks under the repo's strict config.

## Files changed (all inside the lease)

- `apps/web/package.json`, `bun.lock` — Privy and its wagmi adapter.
- `apps/web/src/lib/wallet.ts` — app id, wallet mode and reasons.
- `apps/web/src/app/Providers.tsx` — mode context, both provider trees, watchdog and tab memory.
- `apps/web/src/ui/WalletButton.tsx` — the Connect menu and both modes.
- `apps/web/src/app/shell.css` — the menu, item and reason styles.
- `apps/web/deploy.sh` — the one `VITE_PRIVY_APP_ID` build variable.
- `apps/web/test/wallet.test.ts` — the three mode cases; existing wallet tests unchanged.
- `.packets/reports/ui-A2-privy.md` — this report.

## Verification

From the worktree root, exactly the acceptance chain:

```
bun install                                                          # no changes
bun run typecheck                                                    # pass
bun test apps/web/test                                               # 149 pass, 3 skip, 0 fail
(cd apps/web && VITE_PRIVY_APP_ID=cmw54qend00ce0hidwpsu5p8n bunx --bun vite build)  # pass
(cd apps/web && bunx --bun vite build)                               # pass
```

The 3 skips are the pre-existing live-chain suite in `apps/web/test/onchain.live.test.ts`, gated on `CS_LIVE=1`. Both builds print the usual `node:worker_threads` externalization note from viem's bundled `ox` chain data and the large-chunk warning; neither fails the build. The no-id build is smaller because the embedded-wallet modal code drops out.

## Not checked here

No browser of any kind was launched, per the packet. UI checks go back to the lane as NEEDS-BROWSER:

- the Privy modal with the public app id: email code, passkey, and the wallet option;
- embedded wallet creation on Arc testnet for a user with no wallet, and the account reading connected in wagmi;
- menu open/close by Escape and outside click, and the 44 px targets;
- the no-id and failed-init paths showing the injected menu with one plain reason and no dead button.

The Privy secret and everything under `~/.config/countersign/privy.env` were not read or used; only the public `VITE_PRIVY_APP_ID` crosses into the build.
