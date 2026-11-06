# ui-A2-privy: sign in with email or passkey through Privy, with an embedded wallet on Arc testnet and the injected fallback (refs #21, STEER-2115, STEER-2120 item 1)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-A2`, cut from `cs/ui-A` (ui-A: wagmi with the injected connector, `WalletButton` in the shell).

## The decision (project lead, STEER-2115 and its correction)

- `@privy-io/react-auth` gives email and passkey login, and an embedded wallet on Arc testnet (`eip155:5042002`, `arcTestnet` in `apps/web/src/lib/wallet.ts`). Whitechain testnet is the second chain. EVM chains only: no Hedera wallet in Privy.
- The embedded wallet is created only for users without a wallet: `embeddedWallets.ethereum.createOnLogin = "users-without-wallets"`.
- Smart wallets stay off: a plain embedded EOA, never EIP-7702. Do not install or render any smart-wallet provider.
- `VITE_PRIVY_APP_ID` is read at build time. It is public: `cmw54qend00ce0hidwpsu5p8n`.
- Keep the injected fallback in two cases: no app id, or Privy fails to initialise. In both, injected Connect is shown with one plain line saying why. Never a dead button.
- Another option, a Hedera wallet from cs-hd, will join the Connect menu later, so the menu is a list that a third entry slots into.

## Build

### 1. Dependencies (`apps/web/package.json`, `bun.lock`)

In `apps/web`: `bun add @privy-io/react-auth @privy-io/wagmi`. Pick the newest releases whose peer dependencies accept wagmi 2 and React 19. If the newest needs wagmi 3, pin the last one that takes wagmi 2. Add nothing else.

### 2. The wallet mode (`apps/web/src/lib/wallet.ts`)

- Add `export const PRIVY_APP_ID: string | undefined`, read from `import.meta.env.VITE_PRIVY_APP_ID?.trim() || undefined`.
- Add `export type WalletMode = { privy: boolean; reason: string | null }` and `export function walletModeFor(appId: string | undefined, failed: string | null): WalletMode`:
  - no app id gives `{ privy: false, reason: "Email sign-in is not set up on this console, so connect a browser wallet." }`;
  - a failure gives `{ privy: false, reason: failed }`;
  - otherwise `{ privy: true, reason: null }`.

### 3. The providers (`apps/web/src/app/Providers.tsx`)

- Export a React context, `WalletModeContext`, with a `useWalletMode()` hook.
- **No app id, or after a failure:** render ui-A's tree exactly: `WagmiProvider` with `walletConfig`, then `QueryClientProvider`, providing the mode.
- **With an app id:** render, in Privy's documented order:
  - `<PrivyProvider appId={PRIVY_APP_ID} config={{ loginMethods: ["email", "passkey", "wallet"], embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } }, defaultChain: arcTestnet, supportedChains: [arcTestnet, whitechainTestnet] }}>`;
  - then `<QueryClientProvider>`;
  - then `<WagmiProvider config={privyWagmiConfig}>` from `@privy-io/wagmi`. `privyWagmiConfig` is its `createConfig` with the same two chains and `http()` transports.
- **The watchdog.** Inside the Privy tree, a `PrivyWatchdog` reads `usePrivy().ready`. If it is not true within 8 seconds, it calls `onFail("Email sign-in did not start on this page, so connect a browser wallet.")`. The provider then re-renders in the injected mode and remembers the failure in `sessionStorage` for this tab, under the key `countersign.privy-failed`.

### 4. The Connect menu (`apps/web/src/ui/WalletButton.tsx`)

**Disconnected.** One button, `Connect` (`data-testid="wallet-menu"`, `aria-expanded`), opens a small menu, `<div className="wallet__menu" role="menu">`. Its options come from an array, so another can be appended:
- **Privy mode:**
  - `Sign in with email or passkey` (`data-testid="wallet-signin"`): calls `usePrivy().login()`;
  - `Connect a browser wallet` (`data-testid="wallet-connect-injected"`): calls `usePrivy().connectWallet()`.
- **Injected mode:**
  - `Connect a browser wallet` (`data-testid="wallet-connect-injected"`): ui-A's injected connect;
  - under it, the mode's reason as `<p className="wallet__why" data-testid="wallet-fallback-reason">`.
- **Both modes:** if there is no injected provider, the browser-wallet option reads `No wallet in this browser · Get one`, linking to MetaMask, as ui-A does.
- **Closing:** Escape or a click outside closes the menu.

**Connected** (wagmi's `useAccount`):
- the short address (`data-testid="wallet-address"`, mono), then the chain name (`data-testid="wallet-chain"`);
- `Switch to Arc testnet` when on another chain, as ui-A does;
- `Disconnect` (`data-testid="wallet-disconnect"`). In Privy mode it calls `logout()`, then wagmi's `disconnect`.

Styles go in `apps/web/src/app/shell.css`, beside ui-A's wallet styles:
- `.wallet__menu`: `position: absolute; right: 0; top: 100%; display: grid; min-width: 16rem; padding: var(--sp-2); background: var(--paper); border: var(--hair) solid var(--line); border-radius: var(--r-1);`. The wallet root becomes `position: relative`.
- Menu items are full-width text buttons with 44 px targets.
- `.wallet__why`: slate, `var(--t-12)`.

No blue.

### 5. The build reads the id (`apps/web/deploy.sh`)

In the env of the `vite build` command for `apps/web` (around line 41), add:

```
VITE_PRIVY_APP_ID="${VITE_PRIVY_APP_ID-$(railway variables --service "${RAILWAY_SERVICE:-web}" --kv 2>/dev/null | sed -n 's/^VITE_PRIVY_APP_ID=//p')}"
```

It reads only that one key, and prints nothing.

## Lease

You may create or change only:

- `apps/web/package.json` and `bun.lock`;
- `apps/web/src/lib/wallet.ts`, `apps/web/src/app/Providers.tsx`, `apps/web/src/ui/WalletButton.tsx` and `apps/web/src/app/shell.css`;
- `apps/web/deploy.sh`: that one build variable;
- `apps/web/test/wallet.test.ts`;
- `.packets/reports/ui-A2-privy.md`.

## Tests (`apps/web/test/wallet.test.ts`, extending ui-A's)

- `walletModeFor(undefined, null)` is injected mode, with the not-set-up reason;
- `walletModeFor("x", null)` is Privy mode with no reason;
- `walletModeFor("x", "failed")` is injected mode with that reason.

Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **The Privy secret never enters this code,** and neither does anything from `~/.config/countersign/privy.env`. Only the public app id, through `VITE_PRIVY_APP_ID`.
- No smart wallets. No Hedera in Privy. TypeScript strict, no `any`.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/web/test && (cd apps/web && VITE_PRIVY_APP_ID=cmw54qend00ce0hidwpsu5p8n bunx --bun vite build) && (cd apps/web && bunx --bun vite build)
```

Every command passes; the build passes both with the id and without it.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-A2-privy.md`. Do not push, merge or deploy.
