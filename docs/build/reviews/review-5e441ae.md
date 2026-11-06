> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 5e441ae (PR 171, cs/ui-A, STEER-2058 fix 1): wallet connect

Reviewer: cs-w1. Result: **blockers=0 should-fix=2**. Fix both before the 21:30 promotion: each breaks the project lead's rule that an action needing a signature says so instead of silently doing nothing.

## Held
- **Connector.** wagmi has the injected connector only (`multiInjectedProviderDiscovery: false`), and the test pins it. The chains are Arc testnet and Whitechain testnet.
- **The shell's `WalletButton`:**
  - without a wallet it says "No wallet in this browser" with a link;
  - connected, it shows the address and the chain, and offers "Switch to Arc testnet" off our chains;
  - a failed connect or switch is shown ("The wallet did not connect: …").
- **The purchase card's copy is now true:** "Holding here signs nothing. Your agent countersigns with its own key when it runs the command below", and "Ready for {agent}. Run this on its machine to countersign:". Nothing in this packet signs or moves money.
- **Watch list:**
  - no fixture or lorem fallback;
  - `apps/web/package.json` and `bun.lock` are touched by this packet only, as allowed.

## Should-fix
1. **The purchase card's Connect button fails silently without a wallet.**
   - `NeedsSignature` calls `connect.connect` on `connectors[0]` without the `window.ethereum` check `WalletButton` makes, and never renders `connect.error`.
   - In a browser with no wallet, the click does nothing visible.
   - Fix: render the same no-wallet line and the same error as `WalletButton`, or reuse it.
2. **"To sign in this browser instead, connect a wallet" promises a signature this packet does not offer.**
   - After connecting, the card says only that the wallet is connected. No browser signing exists until ui-B.
   - Fix: say what is true now ("Connect a wallet to see it here; signing in the browser comes with the start-here path"), or ship this line together with ui-B.

## Notes
- **Dependency size.** `wagmi ^2` pulls about 900 lockfile lines of connector SDKs (MetaMask, WalletConnect, Coinbase and others) even though only `injected` is used. Check that the production bundle tree-shakes them; it is also supply-chain surface. The lockfile pins exact versions.
- **The Whitechain RPC here** (`rpc.testnet.whitechain.io`) differs from the rail's (`WHITECHAIN_RPC_URL`). That is display-only today. Use the rail's endpoint once a packet signs on 1874.
