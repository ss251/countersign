# ui-A-wallet: a visible Connect button in the shell, with wagmi's injected connector (refs #21, STEER-2058 fix 1)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/ui-A`, cut from `origin/main`.

## The project lead's words

"Add wagmi with the injected connector plus a visible Connect button in the shell, show the address and chain when connected, and make every action that needs a signature say so instead of silently doing nothing."

## The design is decided (cs-ui)

### 1. Dependencies (`apps/web/package.json`, `bun.lock`)

This is the one packet allowed to change them. In `apps/web`, run `bun add wagmi@^2 @tanstack/react-query@^5`. `viem` is already a dependency. Commit the `package.json` and the `bun.lock` change together. Add nothing else.

### 2. `apps/web/src/lib/wallet.ts` (new)

- **Two chains,** with viem's `defineChain`:
  - `arcTestnet`: id `5042002`, name `"Arc testnet"`, native currency `{ name: "USDC", symbol: "USDC", decimals: 18 }`, rpc `https://rpc.testnet.arc.network`, explorer `{ name: "Arcscan", url: "https://testnet.arcscan.app" }`, `testnet: true`.
  - `whitechainTestnet`: id `1874`, name `"Whitechain testnet"`, native `{ name: "WBT", symbol: "WBT", decimals: 18 }`, rpc `https://rpc.testnet.whitechain.io`, `testnet: true`.
- **`walletConfig`:** `createConfig({ chains: [arcTestnet, whitechainTestnet], connectors: [injected()], multiInjectedProviderDiscovery: false, transports: { [arcTestnet.id]: http(), [whitechainTestnet.id]: http() } })`. The injected connector is the only connector.
- **`chainName(id: number | undefined): string`:** gives the chain's name, `"chain <id>"` for any other id, and `""` for undefined.
- **`shortAddress(a: string): string`:** reuse `shortHex` from `./format.ts`.

### 3. `apps/web/src/app/Providers.tsx` (new), and `apps/web/src/main.tsx`

`Providers` wraps its children in `WagmiProvider config={walletConfig}`, then `QueryClientProvider` with one module-level `QueryClient`. In `main.tsx`, render `<Providers><App /></Providers>` inside `StrictMode`.

### 4. `apps/web/src/ui/WalletButton.tsx` (new): the Connect button

It uses `useAccount`, `useConnect`, `useDisconnect` and `useSwitchChain`. Its states and their exact words:

- **No injected provider** (`typeof window === "undefined" || !("ethereum" in window)`): the text `No wallet in this browser`, then a link `Get one` to `https://metamask.io/download/` (`target="_blank" rel="noreferrer"`).
- **Disconnected:** a button `Connect wallet`. It calls `connect({ connector: connectors[0] })`.
- **Connecting:** the same button, disabled, reading `Connecting`.
- **Connected on Arc testnet or Whitechain testnet:**
  - the short address in mono, then ` · `, then the chain name;
  - then a quiet button `Disconnect`.
- **Connected on another chain:**
  - the short address, ` · chain <id>`;
  - a button `Switch to Arc testnet`, which calls `switchChain({ chainId: 5042002 })`;
  - then `Disconnect`.
- **Error:** a connect or switch error shows one line with `role="status"`: `The wallet did not connect: <error.shortMessage or error.message>`. The line clears on the next attempt.

Markup and classes:

- the root is `<div className="wallet">`;
- buttons are `className="wallet__go"`, and `Disconnect` is `className="wallet__quiet"`;
- the address is `<span className="wallet__who mono">`;
- the error is `<p className="wallet__error">`.

Every button has a type, and the root has `aria-live="polite"`.

### 5. The shell (`apps/web/src/app/App.tsx`, and `apps/web/src/app/shell.css`)

- Render `<WalletButton />` in `TopBar`, between the `topbar__nav` nav and the `topbar__menu` button.
- Inside the mobile sheet (`topbar__sheet`), render it again after the links.

Styles, added to `shell.css` under one comment `/* The wallet: connect, who and which chain. */`:

- `.wallet`: `display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--t-13);`
- `.wallet__go`: a quiet text button, using the existing `.topbar__link` look, with `min-height: 44px; padding: 0 var(--sp-3); border: var(--hair) solid var(--line); border-radius: var(--r-1); background: none; color: var(--ink);`
- `.wallet__quiet`: `background: none; border: 0; color: var(--slate); min-height: 44px; padding: 0 var(--sp-2);`
- `.wallet__who`: `color: var(--ink);`
- `.wallet__error`: `color: var(--seal); font-size: var(--t-12);`

Blue only where money moves: no blue here.

### 6. Say so wherever a signature is needed (`apps/web/src/routes/assistant/Assistant.tsx`)

The assistant's purchase card is the console's one buyer action that needs a signature.

- **Line 258.** Replace `Nothing is signed until you hold to countersign, and the agent pays with its own key.` with `Holding here signs nothing. Your agent countersigns with its own key when it runs the command below.`
- **Line 495.** Replace `Countersigned for {agent}.` with `Ready for {agent}. Run this on its machine to countersign:`
- **Under the card's `HoldToSign` (line 492),** add `<NeedsSignature />` from the new `apps/web/src/ui/NeedsSignature.tsx`. It renders one `<p className="needs-sig">`:
  - not connected: `To sign in this browser instead, connect a wallet.`, followed by a `Connect wallet` button that calls `connect`;
  - connected: `Your wallet <short address> is connected on <chain name>.`

  Style `.needs-sig` in `apps/web/src/routes/assistant/assistant.css`, or the file the card's styles live in: `color: var(--slate); font-size: var(--t-13);`.

## Lease

You may create or change only:

- `apps/web/package.json` and `bun.lock`;
- `apps/web/src/lib/wallet.ts`, `apps/web/src/app/Providers.tsx`, `apps/web/src/main.tsx`, `apps/web/src/app/App.tsx` (TopBar only) and `apps/web/src/app/shell.css`;
- `apps/web/src/ui/WalletButton.tsx` and `apps/web/src/ui/NeedsSignature.tsx`;
- `apps/web/src/routes/assistant/Assistant.tsx` (the three places above) and its stylesheet;
- `apps/web/test/wallet.test.ts` (new);
- `.packets/reports/ui-A-wallet.md`.

## Tests (`apps/web/test/wallet.test.ts`)

No network and no browser. Test:

- `chainName(5042002) === "Arc testnet"`, `chainName(1874) === "Whitechain testnet"` and `chainName(1) === "chain 1"`;
- `walletConfig.connectors` has exactly one connector, and its type is `injected`;
- `walletConfig.chains` maps to the ids `[5042002, 1874]`.

Every existing test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Injected connector only: no WalletConnect, no Coinbase SDK, no Privy.
- Never put a secret or project id in code or in a `VITE_*` variable. TypeScript strict, no `any`.
- Do not change the landing (`apps/web/src/routes/home/**`).

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test apps/web/test && (cd apps/web && bunx --bun vite build)
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #21)`, and no trailers. Write `.packets/reports/ui-A-wallet.md`. Do not push, merge or deploy.
