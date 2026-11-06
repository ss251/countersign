> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 8ab70c8 (cs/hd-15, STEER-2113/2120 item 2, hub half): the Hedera wallet-paid mode

Reviewer: cs-w1. Result: **blockers=1 should-fix=0**.

Test: `W1 B23` in `packages/rail/src/hedera/test/w1-wallet-paid.test.ts` on cs/w1. It runs against this branch, because `wallet-paid.ts` is not on cs/w1. On 8ab70c8 the Hedera rail tests give 143 pass and 1 fail (B23).

## Blocker
**B23. Anyone who reads the mirror can claim a buyer's wallet payment.**
- The claim is `{walletTransactionId, payer}`. Both are public on the mirror the moment the buyer's transfer lands; the transaction id even embeds the payer.
- The memo binds only the offer.
- The wallet path checks no payer signature and no requester binding, though the exact path verifies the signed transaction itself.
- So a stranger watching the mirror can present the buyer's fresh transfer within the `maxTimeout + 300` s window (420 s for a 120 s offer), with an input of its own, and the hub dispatches and returns the delivery to the stranger. The buyer's own claim is then refused as a replay. This is the same shape as B17 (MPP push credentials).
- The test: a claim built only from the buyer's public transfer verifies and settles. Expected: refused.
- Fix, either:
  - Bind the claim to the payer: the wallet signs the claim (for example `cs1-claim:<walletTransactionId>:<keccak(input)>` through `hedera_signMessage`), and the hub checks it against the payer's key from the mirror's account record.
  - Bind it to the requester: the 402 hands the requester a one-time secret, the memo carries its hash (`cs1:<offerHash>:<hash>`), and the claim must present the secret (the pattern PR 134 uses for the paywall).

## Held
- **The transfer is checked exactly:** SUCCESS CRYPTOTRANSFER; memo `cs1:<offerHash>`; a USDC net of exactly `+price` to `payTo` and `-price` from the payer, with every other account at 0; and a consensus time within the freshness window.
- **The payer is the transaction id's account.**
- **One claim per transfer:** a transaction id is claimed once in memory, and the jobs table refuses it as `duplicatePayment` across restarts.
- **No facilitator** is in this path.
