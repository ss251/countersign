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

## An agent paying with no human in the loop

A recorded run on testnet, 2026-11-06. The agent was `0.0.11337064`. Its envelope (the human's limits) had a 0.015 USDC cap, and the offer cost 0.01 USDC:

```
$ bun scripts/hedera/agent-run.ts http://127.0.0.1:8797 --cap 15000 --times 2
envelope cap 0.015 USDC, per merchant 0.5 USDC, spent 0 USDC
listing  0x31b1e2927c499848602a32f6b290f8db4c56f41b71abdc6ee11ab9f3c8c91b9d
offer    hedera stand-in call  price 0.01 USDC  payTo 0.0.11337065
call 1   allow: the envelope covers 0.01 USDC
signed   0.0.9185802@1793958945.424133897
settled  {"success":true,"payer":"0.0.11337064","transaction":"0.0.9185802@1793958945.424133897","network":"hedera:testnet"}
hcs      sequence 1  https://hashscan.io/testnet/topic/0.0.11337070
call 2   refuse: over-cap
message  Refused. This would spend 0.02 of a 0.015 budget.
hcs      sequence 2  https://hashscan.io/testnet/topic/0.0.11337070
```

- **Paid call:** Hedera transaction [`0.0.9185802@1793958945.424133897`](https://hashscan.io/testnet/transaction/0.0.9185802@1793958945.424133897). It moved 0.01 USDC from the agent to the seller; the fee was paid by the x402.org facilitator.
- **Budget cap:** the second call was refused before anything was signed, and the refusal is on the log as well.
- **Spend log:** topic [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070) holds message #1 (the spend, consensus `1793958951.918012104`) and message #2 (the refusal, consensus `1793958953.348483710`).
- **Audit:** `bun scripts/hedera/audit.ts` replays the topic from the mirror node and matches every spend to its transfer: `matched 1  unbacked 0  unlogged 0`.

This run used `scripts/hedera/hub-standin.ts`, a stand-in hub that serves one offer through the same `createHederaRail()` the hub uses. The agent found the offer through `GET /offers`, the hub's listing route.

## The spending log

Each message on topic `0.0.11337070` is one canonical-JSON entry:

```json
{"amount":"10000","asset":"0.0.429274","at":1793958951,"cap":"15000","kind":"spend","network":"hedera:testnet",
 "offerHash":"0x31b1…1b9d","payTo":"0.0.11337065","rail":"hedera","seller":"0x…","total":"10000","tx":"0.0.9185802@1793958945.424133897","v":1}
```

- **Entry kinds:** `kind` is `spend` (it carries `tx`) or `refused` (it carries the envelope's `reason`, such as `over-cap`). `total` is the running spend under the envelope, and `cap` is the envelope's cap.
- **Who can write:** only the agent's key can submit to the topic, and the topic has no admin key. Entries can be appended but never edited, reordered or deleted. Each one is timestamped by network consensus, not by the agent.
- **Journal:** the agent rebuilds its running total from this log at start-up (`spentFromLog`), so the log is the agent's journal as well as its audit trail.
- **Audit:** `audit.ts` reports three lists:
  - **unbacked:** spends the chain does not back, because the transaction is missing or failed, the credit or debit differs, or the memo names another offer;
  - **unlogged:** USDC transfers out of the agent after logging began that no entry names;
  - **matched:** everything else.

  It exits 1 if either of the first two lists is non-empty.

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
bun scripts/hedera/smoke.ts [x402.org|blocky402|local]   # one rail payment end to end, plus a moved-price and a replay refusal
bun scripts/hedera/hub-standin.ts 8797                   # a one-offer stand-in hub behind the hedera rail
bun scripts/hedera/agent-run.ts http://127.0.0.1:8797 --cap 15000 --times 2   # the agent pays, then hits its cap
bun scripts/hedera/audit.ts    # replay the HCS spend log and reconcile it against the chain
```

`setup.ts` is idempotent. Every receiving account must associate the USDC token before it can be paid, or settlement fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; the script associates both the agent and the seller.

## Notes

- The x402 `SettleResponse` for Hedera names the transaction under `transaction`, in the form `<feePayer>@<seconds>.<nanos>`; `payer` is the paying agent. The mirror node REST form of the same id is `<feePayer>-<seconds>-<nanos>`.
- The `@x402/fetch` client refuses non-default assets by default; the agent allow-lists `0.0.429274` with a per-payment cap through `spendControls`.
- A signed payload names one facilitator's fee payer in its transaction id, so it can only settle through that facilitator. Failover happens when the challenge is issued, never mid-settlement, and the same payment can never land twice.
- Testnet fees observed: creating an account or associating a token costs about 0.8 HBAR at the testnet exchange rate. An HCS message costs about 0.01 HBAR, and the facilitator pays the transfer fee.
