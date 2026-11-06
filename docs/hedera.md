# hedera rail

countersign settles agent-to-software payments on Hedera testnet over x402 v2. The paying agent signs a USDC transfer whose memo carries the offer hash. A hosted facilitator co-signs as fee payer and submits it, and every spend is appended to a Hedera Consensus Service (HCS) topic that nobody can edit or delete.

No human approves a payment. The agent's envelope (budget cap, per-merchant limit, allowlist) decides, and the facilitator only broadcasts what the agent signed.

## Payment flow, traced through one real payment

The agent `0.0.11337064` bought one call to Circle's `use-usdc` skill (Apache-2.0) for 0.05 USDC through the countersign hub, with no human approving. The seller's runner served the skill and was paid on Hedera at `0.0.11337065`. Every value below was read back from Hedera testnet.

1. **Discover.** The agent lists offers with `GET /offers` on the hub and picks the one that settles on the `hedera` rail: offer `0xfd440a4a…22fc`. The seller's runner published it with `--rails hedera --pay-to hedera=0.0.11337065`.
2. **Challenge.** The hub answers `402` with x402 v2 payment requirements:
   - `scheme: exact` and `network: hedera:testnet`;
   - `asset: 0.0.429274` (USDC) and `amount: 50000` (0.05 USDC);
   - `payTo: 0.0.11337065`;
   - `extra.feePayer: 0.0.9185802`, the x402.org facilitator's account, read live from its `GET /supported`.
3. **Envelope.** Before signing, the agent checks its envelope. The cap was 0.125 USDC and 0.05 USDC was already spent, a total the agent rebuilds from its own HCS log. The call fits, so it is approved.
4. **Countersign.** The agent signs one Hedera `TransferTransaction`: `-50000` from itself and `+50000` to the seller on token `0.0.429274`, with memo `cs1:fd440a4a…22fc`. One signature binds all three:
   - the memo binds the offer;
   - the transfer list binds the amount and the payee;
   - the transaction id names the facilitator as fee payer, so the agent never pays gas.
5. **Verify.** The hub's hedera rail decodes the transfer and checks it before any facilitator sees it: exactly one debit and one credit, the exact amount and payee, the offer memo, the payer's signature against its on-chain key, and a validity window no longer than the offer allows. Then it asks the facilitator's `POST /verify`.
6. **Settle.** The facilitator adds its fee-payer signature and submits. Transaction [`0.0.9185802@1793962668.996163078`](https://hashscan.io/testnet/transaction/0.0.9185802@1793962668.996163078) reached consensus at `1793962677.946026104` with result `SUCCESS`. The agent was debited 0.05 USDC and the seller credited 0.05 USDC, and the facilitator paid the 0.0162 HBAR network fee.
7. **Deliver.** The hub hands the job to the seller's runner, which returns the skill. Slip `0x765ad929…6966` is signed by the seller and records the rail, the payee, the amount and the settlement with its HashScan link.
8. **Log.** The agent appended the spend to its HCS topic [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070) as [message #10](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/10), at consensus `1793962679.700443752`.
9. **Refuse.** A second call would have spent 0.15 of the 0.125 cap. The agent refused before signing anything: "Refused. This would spend 0.15 of a 0.125 budget." The refusal is logged too, as [message #11](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/11).
10. **Audit.** Anyone can replay the topic from the mirror node and match each spend to its transfer. For this run's window, the audit reported `matched 1, unbacked 0, unlogged 0`.

Two refusals protect the money.

- **A price that moves after signing cannot settle.** The signed amount no longer equals the requirement, so the rail refuses before settlement, and the facilitator's exact-amount rule would refuse it again.
- **A replayed payment is refused.** The rail claims each transaction id once before any facilitator call. When a facilitator does not answer, only a consensus that happened after the attempt counts as settled.

Reproduce it with the commands under "Setup": the hub with `HEDERA_RAIL=1`, a runner serving the skill on the hedera rail, and `scripts/hedera/beat --hub <hub>`.

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

The audit has caught a real gap. At 15:59 IST a rail smoke test (`scripts/hedera/smoke.ts`) paid 0.01 USDC with the agent's key without going through the agent, so nothing was logged: [`0.0.9185802@1793959186.794495705`](https://hashscan.io/testnet/transaction/0.0.9185802@1793959186.794495705). A later agent run settled [`0.0.9185802@1793959685.864333631`](https://hashscan.io/testnet/transaction/0.0.9185802@1793959685.864333631) (entry #3) and was refused at its cap (entry #4). The audit after that run reported `matched 2  unbacked 0  unlogged 1` and named the smoke payment. The log cannot be edited, so that line stays. Smoke tests that pay with the agent's key will append their spends like the agent does.

## Scheduled checkout

The scheduled flow is a second way to pay on the same rail. Nothing moves when the agent creates the payment: the agent submits a `ScheduleCreateTransaction` that wraps the USDC transfer (`agent -amount`, seller `+amount`) with the offer memo `cs1:<offer hash>` on the inner transfer and on the schedule. The create carries an explicit `expirationTime`, `waitForExpiry = false`, and no admin key. The agent signs the create, and that signature counts toward the scheduled transfer.

The seller does not trust the schedule blindly. It reads the schedule's transaction body from the mirror node, decodes the transfer, and checks that it is exactly one debit from the buyer and one credit to itself, of the offer's amount, on `0.0.429274`, with the offer memo. Only then does it submit `ScheduleSignTransaction`. The seller-sign account used here has `receiverSignatureRequired = true`, so its USDC credit cannot execute without that key; the transfer runs as soon as the second signature lands.

If the seller never signs, the schedule reaches its expiration and is deleted by the network without moving funds. There is no refund to issue because the agent's balance was never debited.

- **Seller key:** `scripts/hedera/keygen.ts` adds `SELLER_SIGN` (`HD_SELLER_SIGN_KEY`, `_EVM`, `_ID`). `scripts/hedera/setup.ts` creates that account from the operator with `setReceiverSignatureRequired(true)` and seeds it with 0.3 HBAR for its `ScheduleSign` fees and USDC association.
- **Spend log:** a scheduled spend logs `kind: "spend"`, `tx` = the schedule create transaction id, and `schedule` = the schedule id. `reconcile` reads its execution with `GET /api/v1/transactions/{createTxId}?scheduled=true` and applies the same exact-amount and memo checks as an unscheduled spend.
- **Commands:**

```sh
bun scripts/hedera/schedule.ts                # create, seller check-and-sign, execute, log, audit
bun scripts/hedera/schedule.ts --expiry-demo  # create, never sign, show expired with nothing moved
```

The main run prints the create transaction and schedule links, the seller's sign transaction, the executed transfer's consensus time, the seller's credit, the HCS entry, and a reconciliation of the run's window. The expiry demo prints the schedule link, waits past its expiration, and shows `expired`, no `executed_timestamp`, and an unchanged agent USDC balance.

## Setup

Keys live only in `~/.config/countersign/hd.env` (mode 0600). The scripts print addresses and ids, never keys.

```sh
bun scripts/hedera/keygen.ts   # four ECDSA keys: operator, agent, seller, seller-sign; prints EVM addresses
# fund the operator's EVM address with testnet HBAR at https://portal.hedera.com/faucet
bun scripts/hedera/setup.ts    # creates agent + seller + seller-sign from the operator, associates USDC, creates the topic
# send testnet USDC to the agent account at https://faucet.circle.com (network: Hedera Testnet)
bun scripts/hedera/status.ts   # HBAR and USDC balances from the mirror node
bun scripts/hedera/smoke.ts [x402.org|blocky402|local]   # one rail payment end to end, plus a moved-price and a replay refusal
bun scripts/hedera/hub-standin.ts 8797                   # a one-offer stand-in hub behind the hedera rail
bun scripts/hedera/agent-run.ts http://127.0.0.1:8797 --cap 15000 --times 2   # the agent pays, then hits its cap
bun scripts/hedera/audit.ts    # replay the HCS spend log and reconcile it against the chain
scripts/hedera/beat            # the recorded demo beat: one paid call, the cap refusal, both HCS entries, the audit
```

Through the real hub. Set the seller key in `CS_SELLER_KEY` from the seller's key file, and never pass it as an argument:

```sh
HEDERA_RAIL=1 PORT=8811 bun run apps/hub/src/index.ts
bun packages/runner/src/cli.ts serve --hub http://127.0.0.1:8811 \
  --skill examples/catalogue/circle/use-usdc/SKILL.md --price 50000 \
  --rails hedera --pay-to hedera=0.0.11337065
scripts/hedera/beat --hub http://127.0.0.1:8811
```

`agent-run.ts` and `audit.ts` both take `--json`, which prints one evidence object for the `#/demo` page on stdout, in the form `{beat, ok, evidence: [{label, value, url?}]}`. The usual lines go to stderr. The smoke test appends its own spend to the HCS log, like the agent does.

`setup.ts` is idempotent. Every receiving account must associate the USDC token before it can be paid, or settlement fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; the script associates both the agent and the seller.

## Notes

- The x402 `SettleResponse` for Hedera names the transaction under `transaction`, in the form `<feePayer>@<seconds>.<nanos>`; `payer` is the paying agent. The mirror node REST form of the same id is `<feePayer>-<seconds>-<nanos>`.
- The `@x402/fetch` client refuses non-default assets by default; the agent allow-lists `0.0.429274` with a per-payment cap through `spendControls`.
- A signed payload names one facilitator's fee payer in its transaction id, so it can only settle through that facilitator. Failover happens when the challenge is issued, never mid-settlement, and the same payment can never land twice.
- Testnet fees observed: creating an account or associating a token costs about 0.8 HBAR at the testnet exchange rate. An HCS message costs about 0.01 HBAR, and the facilitator pays the transfer fee.
