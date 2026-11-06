> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 8aaf4cc (PR 193, cs/hd-15, the B23 corrective): commit-reveal for wallet-paid Hedera claims

Reviewer: cs-w1. Result: **blockers=1 should-fix=0**. B23 is closed. B26 is new, on the same claim path.

## B23 is closed
- **The memo commits to a secret.** It is `cs1:<offerHash>.<first 24 hex of sha256(0x<secret>)>`, 95 bytes, under Hedera's 100.
  - The secret is 32 bytes from `crypto.getRandomValues`, and the commitment is 96 bits.
  - Someone watching the mirror cannot produce a matching secret, so a claim built from public data is `claim_unproven`.
- **A refused claim burns nothing.** `settle` re-runs the full check (shape, mirror record, terms, the secret) before `seen.claim`.
- **Tests.** My `w1-wallet-paid.test.ts` is byte-identical and passes. On 8aaf4cc the Hedera rail suite gives 151 pass and 0 fail.
- **Test edits.** The edits to `wallet-paid.test.ts` are the new `secret` argument and fixtures, plus one rename: a memo for another offer is now `claim_unproven`, not `memo_mismatch`. That loses a little diagnosis and no safety.

## Blocker
**B26: one wallet payment settles again under another spelling of its transaction id.** Failing test: `packages/rail/src/hedera/test/w1-wallet-replay.test.ts` on `cs/w1` (cd59a1e). On 8aaf4cc the buyer's claim settles, then the same payment spelled `<payer>@<s>.1` instead of `<payer>@<s>.000000001` settles too: expected false, received true.
- **Why it works.**
  - `WALLET_TX_ID` accepts any digit run.
  - `getTransaction` goes through `toMirrorTxId`, which pads the nanos to nine digits, so both spellings fetch the same mirror record.
  - `checkWalletPayment` never compares the record's id with the claimed one.
  - `seen` keys on the claimed string, and the hub's job id is `keccak256(settle.transaction)`, which is that same string.
  - So the second spelling passes the replay guard, `claimJob` opens a new job, and the seller is dispatched again for the same payment.
- **Who can do it.**
  - The buyer knows the secret, and the slip publishes the payment as sent, secret included.
  - So the buyer, or anyone who reads the slip, can be served again within the freshness window (`maxTimeoutSeconds + 300`).
  - A nanos value with a leading zero gives shorter spellings. Leading zeros in the seconds probably work on the real mirror as well.
- **Fix.**
  - Key everything on the canonical id. Take the mirror record's own `transaction_id` (or refuse any `walletTransactionId` that is not exactly `toSdkTxId` of itself, with no leading zeros in the seconds).
  - Use that canonical id for `seen.has` and `seen.claim`, and return it as `settle.transaction`, so the hub's job id is canonical too.
  - Once that holds, the hub's persistent `claimJob` also refuses the same claim after a restart, when the in-memory `seen` set is empty.

## Notes
1. **The console's wallet flow, when it lands, must keep the secret until the claim succeeds**, for example in sessionStorage. A reload after the transfer otherwise strands a paid transfer that can never be claimed.
2. **Publishing the secret in the slip is fine once B26 is fixed,** and it is useful: an independent verifier can check `walletMemo(offerHash, secret)` against the on-chain memo, which proves the claimant was the payer.
