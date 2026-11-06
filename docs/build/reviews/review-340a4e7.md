> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 340a4e7 (PR 190, cs/ui-A2, STEER-2120 item 1 and A6): Privy sign-in in the console

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

## Held
1. **Provider config.**
   - `PrivyProvider` uses email, passkey and wallet login, and `createOnLogin: 'users-without-wallets'` (A6).
   - Arc testnet is the default chain, with Whitechain the only other chain. There are no smart wallets, so the payer stays an EOA. That matches the hub's linked-wallet check (#185).
   - The provider order is right: Privy, then react-query, then `@privy-io/wagmi`.
2. **Fallbacks are honest.**
   - Without an app id, the console renders ui-A's injected tree with "Email sign-in is not set up on this console, so connect a browser wallet."
   - If Privy is not ready in 8 s, the console renders the same tree with "Email sign-in did not start on this page, so connect a browser wallet."
   - A failed connect or chain switch shows "The wallet did not connect: …".
3. **Watch list.**
   - There is no fixture or lorem.
   - This packet has no signature action.
   - It touches the lockfile because Privy needs it (see note 4).
4. **`deploy.sh`** reads only `VITE_PRIVY_APP_ID` from Railway: sed keeps that one line and stderr is dropped. The packet report says the Privy secret was not read. The app id is public by design.
5. **Tests.** On 340a4e7 with a frozen install, `bun test apps/web` gives 156 pass, 0 fail and 3 skip (the CS_LIVE on-chain suite). The test change only adds three `walletModeFor` tests, and the pin on the one injected connector stays.

## Should-fix
1. **Make the embedded wallet always show its signing prompt: set `embeddedWallets.showWalletUIs: true`.**
   - In react-auth 3.6.1, an unset `showWalletUIs` follows the Privy dashboard's setting ("If not set, the default behavior will match the server configuration").
   - If the dashboard has wallet UIs off, the embedded wallet signs typed data with no prompt. That includes the buyer's `ReceiveWithAuthorization` once ui-B signs with it.
   - Then any script on the page could sign a payment authorization the person never saw, and a signature would not "say so". One line in code makes the prompt independent of a dashboard toggle.

## Notes
1. **In Privy mode, "Connect a browser wallet" calls `connectWallet()`, which connects a wallet without linking it to the person.**
   - The hub's Privy check (#185) accepts only linked wallets.
   - Once the console sends `x-privy-token`, a payment from such a wallet will be refused as not-your-wallet.
   - When the header is added, either use `linkWallet()` for this option, or send the header only when the paying address is one of the person's linked accounts.
2. **The first purchase right after the first login meets #185's should-fix.** The embedded wallet appears just after login, so the hub's 60 s wallet cache must re-read on a miss before the item-1 recording.
3. **A watchdog fallback lasts for the whole tab session, reload included, with no retry.**
   - On a slow first load, for example a phone on a cold network, email sign-in stays off in that tab until it is closed. The reason line says why, so this is honest, not silent.
   - Suggested fix: a "Try email sign-in again" menu item that clears `countersign.privy-failed`.
   - The Privy dashboard must also allow the production console's origin, otherwise `ready` never comes and every visitor falls back.
4. **Lockfile against cs/int.**
   - No name@version is removed, and 108 are added.
   - ui-A's wagmi connectors keep their pinned versions through nested entries: `@walletconnect/ethereum-provider` 2.21.1, `@coinbase/wallet-sdk` 4.3.6, `@base-org/account` 2.4.0. Privy's tree takes the top-level reown and walletconnect slots.
   - #185 also changes bun.lock. Whichever lands second regenerates it and should repeat this check.
5. **react-auth is pinned to 3.6.1.** Per the packet report, the newest release pulls `x402` 0.7 and `@solana/kit` 5, which break under bun 1.3.14. That is fine tonight; upgrade after submission.
