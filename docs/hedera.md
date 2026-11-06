# hedera rail

countersign settles agent-to-software payments on Hedera testnet over x402 v2. The paying agent signs a USDC transfer whose memo carries the offer hash. A hosted facilitator co-signs as fee payer and submits it, and every spend is appended to a Hedera Consensus Service (HCS) topic that nobody can edit or delete.

No human approves a payment. The agent's envelope (budget cap, per-merchant limit, allowlist) decides, and the facilitator only broadcasts what the agent signed.

## Live facts (testnet, checked 2026-11-06)

| What | Value |
|---|---|
| Network (CAIP-2) | `hedera:testnet` |
| Asset | USDC `0.0.429274` (HTS fungible token, 6 decimals, Circle) |
| Agent (payer) | [`0.0.11337064`](https://hashscan.io/testnet/account/0.0.11337064) |
| Seller (payee) | [`0.0.11337065`](https://hashscan.io/testnet/account/0.0.11337065) |
| Operator (setup and topic creation) | [`0.0.11337061`](https://hashscan.io/testnet/account/0.0.11337061) |
| Spend-log topic | [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070): no admin key, submit key = agent |
| Mirror node | `https://testnet.mirrornode.hedera.com` |

### Facilitators

Both hosted facilitators below answer `GET /supported` with `x402Version: 2`, scheme `exact`, network `hedera:testnet`, and neither needs an API key. Each pays Hedera fees from its own account and publishes that account under `extra.feePayer`. The rail reads that value live and never hard-codes it.

| Facilitator | Base URL | Fee payer on 2026-11-06 | Settled USDC payment |
|---|---|---|---|
| x402.org (default) | `https://x402.org/facilitator` | `0.0.9185802` | [`0.0.9185802@1793957141.182486461`](https://hashscan.io/testnet/transaction/0.0.9185802@1793957141.182486461) |
| Blocky402 (fallback) | `https://api.testnet.blocky402.com` | `0.0.7162784` | [`0.0.7162784@1793957147.245656565`](https://hashscan.io/testnet/transaction/0.0.7162784@1793957147.245656565) |

Each payment above moved 0.01 USDC from the agent to the seller (`-10000` / `+10000` atomic on `0.0.429274`), with result `SUCCESS` on the mirror node. Neither facilitator had to be written or run by us.

A transfer carrying the offer-hash memo settles through both facilitators unchanged: [`0.0.9185802@1793957160.527396289`](https://hashscan.io/testnet/transaction/0.0.9185802@1793957160.527396289) and [`0.0.7162784@1793957166.822859360`](https://hashscan.io/testnet/transaction/0.0.7162784@1793957166.822859360) both record memo `cs1:abab…ab` on chain.

## Payment flow

1. **Challenge.** The agent asks for a paid resource. The hub answers `402` with a `PAYMENT-REQUIRED` header: x402 v2 `PaymentRequirements` with `scheme: exact`, `network: hedera:testnet`, `asset: 0.0.429274`, `amount` in atomic USDC, `payTo` = the seller's account, and `extra.feePayer` = the chosen facilitator's fee-payer account.
2. **Envelope.** The agent checks the price against its envelope (budget cap, per-merchant limit, allowlist, revocation). Nothing above the cap is ever signed.
3. **Countersign.** The agent builds a Hedera `TransferTransaction`: `-amount` from itself and `+amount` to `payTo` on the USDC token, transaction id paid by `extra.feePayer`, memo `cs1:<offer hash>`. It signs with its own key, leaving the fee payer's signature missing, and retries with the base64 transaction in `PAYMENT-SIGNATURE`. That signature binds the amount, the payee and the offer.
4. **Verify.** The hub decodes the transaction and checks the memo, amount, token and payee against the offer before asking the facilitator's `POST /verify`. The facilitator separately checks that the transfer list holds only this payment, nets to zero, never debits the fee payer, and carries the payer's valid signature.
5. **Settle.** The facilitator adds its fee-payer signature and submits (`POST /settle`). Hedera reaches consensus in a few seconds. The response names the transaction id, and the slip records it with its HashScan link.
6. **Log.** The agent appends the spend to topic `0.0.11337070`: offer, seller, amount, transaction id, running total. Anyone can replay the topic from the mirror node and match each entry to its transfer.

A price that moved after the agent signed cannot settle. The signed amount no longer equals `PaymentRequirements.amount`, the hub refuses before settlement, and the facilitator's exact-amount rule refuses it again.

## Setup

Keys live only in `~/.config/countersign/hd.env` (mode 0600). The scripts print addresses and ids, never keys.

```sh
bun scripts/hedera/keygen.ts   # three ECDSA keys: operator, agent, seller; prints EVM addresses
# fund the operator's EVM address with testnet HBAR at https://portal.hedera.com/faucet
bun scripts/hedera/setup.ts    # creates agent + seller from the operator, associates USDC, creates the topic
# send testnet USDC to the agent account at https://faucet.circle.com (network: Hedera Testnet)
bun scripts/hedera/status.ts   # HBAR and USDC balances from the mirror node
```

`setup.ts` is idempotent. Every receiving account must associate the USDC token before it can be paid, or settlement fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; the script associates both the agent and the seller.

## Notes

- The x402 `SettleResponse` for Hedera names the transaction under `transaction`, in the form `<feePayer>@<seconds>.<nanos>`; `payer` is the paying agent. The mirror node REST form of the same id is `<feePayer>-<seconds>-<nanos>`.
- The `@x402/fetch` client refuses non-default assets by default; the agent allow-lists `0.0.429274` with a per-payment cap through `spendControls`.
- A signed payload names one facilitator's fee payer in its transaction id, so it can only settle through that facilitator. Failover happens when the challenge is issued, never mid-settlement, and the same payment can never land twice.
- Testnet fees observed: creating an account or associating a token costs about 0.8 HBAR at the testnet exchange rate. An HCS message costs about 0.01 HBAR, and the facilitator pays the transfer fee.
