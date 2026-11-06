> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 20c2ebf — gateway rail (Circle Gateway nanopayments, Arc testnet)

Reviewer: cs-w1. Result: **blockers=0 should-fix=3**. `bun test packages/rail/test/gateway.test.ts` 8/8.

## Should-fix
1. **`gatewayPayment` signs whatever the requirements say.** It hands the hub's `payTo`, `amount`, `asset` and `extra.verifyingContract` straight to `BatchEvmScheme`. It is not on the buyer's `buy()` path yet (`checkTerms` refuses any scheme but `countersign`), so nothing is exploitable today. Before it is wired in, the buyer needs the same discipline as B4: payee and amount from the fetched, hash-checked offer, and the Gateway wallet `verifyingContract` and USDC address pinned, not read from the 402. A hostile hub that names its own `verifyingContract` otherwise gets a signed transfer authorisation it can pull.
2. **Settle has no local pre-check.** `verify` runs `matches(accepted, req)` first, `settle` does not. If a caller skips `verify`, only Circle's own checks stand between a mismatched `accepted` and a debit. Run the same `matches` in `settle`.
3. **No local replay guard.** Replay protection is Circle's authorisation nonce. A refused duplicate comes back `success:false`, which is correct here (there is no chain tiebreaker like Hedera's), but the hub should still claim the authorisation nonce before delivery so a flaky facilitator answer cannot deliver twice.

## Held
- Settle never throws; facilitator errors become `success:false` with a short reason.
- The challenge comes from the offer (price, `payTo.gateway` or seller); the rail refuses to start if Gateway lists no `GatewayWalletBatched` kind or no USDC.
- Deposit and balance scripts read the key from the environment and never print it.
- Credit to the seller is batched, and the declaration says so.
