> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# STEER-2113: user-held Hedera wallets

From the project lead at about 21:12 IST. This replaces the 21:25 "only if the clock allows" line: the item is now firm. **Deadline 00:30**, and it runs after the production Privy purchase.

## The ask

**Three classes of user.** We support every class of user, not one. The README says so plainly, in these terms:

1. an embedded wallet via Privy on Arc and Whitechain;
2. a user-held Hedera wallet via WalletConnect on Hedera;
3. the agent-custodied Hedera account, bounded by the envelope, for people who do not want a wallet at all.

**The connector.** It is a second option beside Privy, never a replacement.

- **Stack:** `@hashgraph/hedera-wallet-connect` over WalletConnect v2, with Reown AppKit handling the session, so that HashPack, Blade and Kabila can connect.
- **Scope:** `hedera:testnet`. We ask for the account id plus the signer.

**The flow:**

1. The user connects a Hedera wallet.
2. The app builds the `TransferTransaction` to the offer's `payTo`, with memo `cs1:<offerHash>`.
3. The wallet signs and executes it.
4. Before the seller runs, the hub's hedera rail checks the transaction against the mirror node: the transaction id, the memo, the amount and the payer.

## Owner, and what is decided here

**cs-hd owns the item.** It is Opus design, because it changes the money path; DeepSeek packets execute it.

| Part | What it does |
|---|---|
| hd-15 hub | The hedera rail's wallet-paid mode. The mirror node must show the transaction succeeded, from the connected payer, to the offer's `payTo`, for exactly the price in the offer's asset, with memo `cs1:<offerHash>`. **A transaction id is accepted for one job only, so one payment never buys two calls.** It refuses before the seller runs on any mismatch. It has tests. |
| hd-16 web | The connector, offered beside Privy in the Connect menu: AppKit session, account id and signer, and building and submitting the transfer. Lease: the Connect menu and a new buyer step. Rebase on cs-ui's shell work. |
| hd-17 proof | The proof bar below. |

**This is a direct payment.** Money moves before the seller runs. Under the direct-rail honesty item, the page says before signing that a failed delivery is not returned automatically. Making it a held payment is not tonight's ask.

## The proof bar

Be honest about this. We do not have a HashPack account to click through tonight. So the proof is:

- the connector loads and opens a session;
- it builds and submits a real testnet transfer, signed by a local Hedera key standing in for the wallet;
- the hub verifies that transfer and the seller runs;
- the slip verifies.

The WalletConnect round trip itself is then a one-line manual check that the project lead can do. Document it in `docs/hedera.md`.

**HBAR budget.** The stand-in account pays its own fees, so cs-e2e's held-purchase budget is untouched.

## The fallback

If this threatens the recording, the connector ships behind a flag (`VITE_HEDERA_WC`). It ships with the flow tested against the stand-in signer and with the manual step documented, because a half-wired wallet button on stage is worse than none.

## Blocked input

Reown AppKit needs a WalletConnect project id. The firstmate has asked the project lead for it. Build behind `VITE_WC_PROJECT_ID`; with it unset, no Hedera wallet option is shown.

## Docs

cs-readme writes the three classes of user into the README and the rails doc, as one plain table, beside the earlier line "the person's wallet on EVM, the agent's account on Hedera, one envelope over both".

## Slot order

1. The production Privy purchase (ui-A2, the hub Privy packet, e2e/human).
2. hd-15, then hd-16.
3. The hub lane items are already running and finish.

The cap is still 5 unless the project lead changes it.

## Amendment, project lead ~21:15 IST: prove the WalletConnect round trip tonight (replaces hd-17's stand-in-key proof)

Build a real WalletConnect v2 wallet in the repo at **`packages/hedera-wallet-test`**, so the test is a genuine protocol session and not a stub.

**The wallet:**

- **Stack:** `@walletconnect/core` plus `@reown/walletkit` plus `@hashgraph/hedera-wallet-connect`.
- **Behaviour:** it pairs by URI, approves a session for `hedera:testnet`, and answers `hedera_signAndExecuteTransaction` by signing with a locally generated ED25519 key.

**The account:**

- Create and fund it on Hedera testnet from the operator (0.0.11337061), and associate USDC 0.0.429274.
- Keep the key in the build machine's `~/.config/countersign/hedera-wallet.env`, mode 600. It is never printed and never in argv.
- The operator held about 0.38 HBAR at 21:00. Creating the account, associating USDC and doing a few transfers each cost well under 0.1 HBAR, so give the new account about 0.2 HBAR.
- Its USDC for one or two purchases comes from a fleet account that holds USDC. Never use the faucet.

**The end-to-end run, for real:**

1. The app opens a WalletConnect session. For the headless run this is the connector's own dApp side in node, the same code the web connector uses.
2. The test wallet pairs and approves.
3. The app builds the `TransferTransaction` with the offer memo.
4. The wallet signs and executes it.
5. The hub verifies payer, amount and memo against the mirror node before the seller runs.

This is the same wire path HashPack and Blade use; the only difference on stage is the wallet's chrome.

**Report:** when the headless round trip passes, post `READY firstmate` with the session topic, the transaction id and the mirror-node readback.

**The human pass (HashPack web, testnet):**

- The firstmate does not create or import a wallet account: that needs a password and a private key.
- So this is the project lead's 30-second pairing once hd-16 is live. The headless wallet is the evidence, and the manual check is one line in the demo script.

**Blocked input:** the WalletConnect project id. Both the app and the test wallet need it to reach the relay; the firstmate has asked the project lead. Write everything against `WC_PROJECT_ID` and `VITE_WC_PROJECT_ID` so it runs the moment the id lands.
