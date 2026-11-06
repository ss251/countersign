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

### On the public hub

The same beat runs against the production hub that the console reads, [`hub-production-e85e.up.railway.app`](https://hub-production-e85e.up.railway.app/settlements). There, Circle's `use-usdc` is offer `0x41536222…0ae0`, payable on escrow, Gateway and Hedera for 0.01 USDC. The production hub holds no Hedera key.

- **Payment.** The agent paid with no human step: [`0.0.9185802@1793966332.720364516`](https://hashscan.io/testnet/transaction/0.0.9185802@1793966332.720364516), settled by the x402.org facilitator. Result `SUCCESS` at `1793966342.154129104`: agent -0.01 USDC, seller `0.0.11337065` +0.01 USDC, memo `cs1:41536222…`.
- **Slip.** The hub lists the job at `/settlements`. Its seller-signed slip `0xe15834f1a7d4916894f6778a8922f0b325787e6d4a89a6a941f15df28c56cb74` is served at `/slips/<hash>`.
- **Spend log and audit.** Spend entry #26, cap refusal #27 ("Refused. This would spend 0.19 of a 0.185 budget."). Audit: matched 1, unbacked 0, unlogged 0.

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

- **Entry kinds:** `total` is the running spend under the envelope, and `cap` is the envelope's cap. `kind` is one of:
  - `spend`, which carries `tx`;
  - `refused`, which carries the envelope's `reason`, such as `over-cap`;
  - `schedule` and `expired`, for the scheduled checkout below.
- **Who can write:** only the agent's key can submit to the topic, and the topic has no admin key. Entries can be appended but never edited, reordered or deleted. Each one is timestamped by network consensus, not by the agent.
- **Journal:** the agent rebuilds its running total from this log at start-up (`spentFromLog`), so the log is the agent's journal as well as its audit trail.
- **Audit:** `audit.ts` reports five lists:
  - **unbacked:** spends the chain does not back, because the transaction is missing or failed, the credit or debit differs, or the memo names another offer. An `expired` entry whose schedule actually executed lands here too;
  - **unlogged:** USDC transfers out of the agent after logging began that no entry names;
  - **pending:** schedules still waiting for the seller's key;
  - **released:** schedules that expired without moving anything;
  - **matched:** everything else.

  It exits 1 if unbacked or unlogged is non-empty.

The audit has caught a real gap. At 15:59 IST a rail smoke test (`scripts/hedera/smoke.ts`) paid 0.01 USDC with the agent's key without going through the agent, so nothing was logged: [`0.0.9185802@1793959186.794495705`](https://hashscan.io/testnet/transaction/0.0.9185802@1793959186.794495705). A later agent run settled [`0.0.9185802@1793959685.864333631`](https://hashscan.io/testnet/transaction/0.0.9185802@1793959685.864333631) (entry #3) and was refused at its cap (entry #4). The audit after that run reported `matched 2  unbacked 0  unlogged 1` and named the smoke payment. The log cannot be edited, so that line stays. Smoke tests that pay with the agent's key will append their spends like the agent does.

## Scheduled checkout

The scheduled flow is a second way to pay on the same rail. Nothing moves when the agent creates the payment: the agent submits a `ScheduleCreateTransaction` that wraps the USDC transfer (`agent -amount`, seller `+amount`) with the offer memo `cs1:<offer hash>` on the inner transfer and on the schedule. The create carries an explicit `expirationTime`, `waitForExpiry = false`, and no admin key. The agent signs the create, and that signature counts toward the scheduled transfer.

The seller does not trust the schedule blindly. Its signature is the authority that lets the transfer run, so it reads every byte of what it signs:

1. It reads the schedule's body from the mirror node only.
2. It decodes the body with the generated `SchedulableTransactionBody` decoder and requires an exact re-encode. A body that repeats a member, adds a second member of the transaction oneof, or carries an unknown field is not canonical, and it is refused.
3. The body may hold only a token transfer, its memo and its fee. Allowance debits are refused.
4. The transfer must be exactly one debit from the buyer and one credit to the seller, of the offer's amount, on `0.0.429274`, with the offer memo.

Only then does it submit `ScheduleSignTransaction`. The seller-sign account has `receiverSignatureRequired = true`, so its USDC credit cannot execute without that key. The transfer runs as soon as the second signature lands.

If the seller never signs, the schedule reaches its expiration and the network deletes it without moving funds. There is no refund to issue, because the agent's balance was never debited.

- **Envelope:** a schedule counts against the agent's cap from the moment it exists, because the seller can execute it at any time until it expires.
  - The agent reserves the amount before it submits the create.
  - Right after the create, it appends a `schedule` entry to the spend log: `tx` is the create transaction id, `schedule` is the schedule id, and `expiresAt` is the expiration.
  - When the mirror node shows the schedule expired, the agent appends an `expired` entry and releases the hold.
  - `reconcile` backs a `schedule` entry with the execution record (`GET /api/v1/transactions/{createTxId}?scheduled=true`) and the same exact-amount and memo checks as a spend. Without an execution, the entry is pending or released.
- **Seller key:** `scripts/hedera/keygen.ts` adds `SELLER_SIGN` (`HD_SELLER_SIGN_KEY`, `_EVM`, `_ID`). `scripts/hedera/setup.ts` creates that account from the operator with `setReceiverSignatureRequired(true)` and seeds it with 0.3 HBAR for its `ScheduleSign` fees. The operator pays every USDC association.
- **Commands:**

```sh
bun scripts/hedera/schedule.ts                # create, seller check-and-sign, execute, log, audit
bun scripts/hedera/schedule.ts --expiry-demo  # create, never sign, release the hold once it expires
bun scripts/hedera/schedule.ts --json         # either mode: human lines on stderr, one evidence object on stdout
```

### Traced live

Every value below was read back from Hedera testnet on 06 Nov.

- **Main run.** The agent created [`0.0.11337064@1793965412.228050109`](https://hashscan.io/testnet/transaction/0.0.11337064@1793965412.228050109), which made schedule [`0.0.11338645`](https://hashscan.io/testnet/schedule/0.0.11338645) and logged entry #23 (`schedule`).
  - The seller checked the body and signed: [`0.0.11338176@1793965419.166594063`](https://hashscan.io/testnet/transaction/0.0.11338176@1793965419.166594063).
  - The transfer executed at consensus `1793965422.905201235` with result `SUCCESS`: agent -0.01 USDC, seller-sign account `0.0.11338176` +0.01 USDC.
  - Audit of the run: matched 1, unbacked 0, unlogged 0.
- **Expiry run.** The agent created [`0.0.11337064@1793965439.994154527`](https://hashscan.io/testnet/transaction/0.0.11337064@1793965439.994154527), which made schedule [`0.0.11338653`](https://hashscan.io/testnet/schedule/0.0.11338653) and logged entry #24 (`schedule`).
  - Nobody signed, and the schedule expired with no `executed_timestamp`.
  - The agent logged entry #25 (`expired`) and released the hold.
  - The agent's balance stayed at 19.75 USDC before and after. Audit: released 1, unbacked 0.

  "Expired. Nothing moved."

## The Hedera Agent Kit as a metered offer

The runner's `mcp` adapter sells one tool of an MCP server as an offer. For each paid job, the runner:

1. spawns the server over stdio, inside the same scrubbed child as every other adapter (its own `PATH` and a temporary `HOME`);
2. calls the tool once with the buyer's input;
3. closes the server.

The output is the call record `{tool, server, package, inputHash, result}`, and the slip's `outputHash` commits to it.

The first such offer is the Hedera Agent Kit's `transfer_hbar_tool`, from `@hashgraph/hedera-agent-kit-mcp` 1.2.0 with `@hashgraph/hedera-agent-kit` 4.2.0.

- **The seller holds no Hedera key.** The server runs in `RETURN_BYTES` mode on a testnet client with no operator. It builds the transfer and returns the unsigned bytes, and it cannot sign or submit anything.
- **The bytes are built for the buyer.** The offer's server arguments include `--account-id {buyer}`.
  - The runner replaces an argument that is exactly `{buyer}` with the paying account.
  - It refuses the job unless that account is a Hedera id (`0.0.N`) or an EVM address.
  - So the transaction id names the account that has to sign it.
- **Whole HBAR only.** The offer's input schema is the tool's own, with `number` tightened to `integer`.
  - A fractional amount is refused with `422` before any payment: `/transfers/0/amount must be integer`.
  - The hub's canonical-JSON gate also refuses non-integer numbers in any offer's input.
- **The result is untrusted.** A buyer decodes and checks the bytes before signing them. `scripts/hedera/agent-run.ts --offer <hash> --input <json>` prints the decoded transaction next to the slip.

### Traced live on the public hub

Every value below was read back from Hedera testnet and the production hub on 06 Nov.

- **Offer.** [`0xa59402d5…d04f`](https://hub-production-e85e.up.railway.app/offers/0xa59402d532082839c3d8a1cf0c185037dea70197779d1f1303feb8a74725d04f), "Hedera Agent Kit: an HBAR transfer, built for you to sign".
  - 0.03 USDC on the hedera rail, payTo `0.0.11337065`, seller `0xE4eBF122…B5fE`.
  - A runner on the seller's machine serves it.
- **Payment.** The agent `0.0.11337064` paid with no human step: [`0.0.9185802@1793969029.758994311`](https://hashscan.io/testnet/transaction/0.0.9185802@1793969029.758994311).
  - `SUCCESS` at `1793969038.017472348`, memo `cs1:a59402d5…`.
  - The agent was debited 0.03 USDC and the seller credited 0.03 USDC.
  - Spend entry [#36](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/36).
- **Slip.** `0x825642a40fe978d5ad3a06883491639913e6e2349074ea4cfd85eaa8ab49b11b`, served at `/slips/<hash>`.
  - Rail `hedera`, buyer `0.0.11337064`.
  - inputHash `0x3aaa17cb…e072`, outputHash `0xf1291b96…7e22`.
- **Result.** A `TransferTransaction` whose transaction id names `0.0.11337064`.
  - It moves 1 HBAR from `0.0.11337064` to `0.0.11337065`, with memo `countersign mcp demo`.
  - Nobody signed or submitted it.
- **A paid call that delivered nothing.** The first live call went to the earlier listing `0x201414ee…` and asked for 0.01 HBAR.
  - The payment settled: [`0.0.9185802@1793968507.953096251`](https://hashscan.io/testnet/transaction/0.0.9185802@1793968507.953096251), entry [#34](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/34).
  - The runner could not hash the fractional input canonically, so no slip was signed.
  - The hedera rail has no escrow, so nothing refunded the 0.03 USDC.
  - That call is why amounts are whole HBAR, and why the hub refuses such input before any payment.
  - The same listing then served a whole amount: [`0.0.9185802@1793968558.322770641`](https://hashscan.io/testnet/transaction/0.0.9185802@1793968558.322770641), entry [#35](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/35), slip `0xfe05bd21…d75f`.

## ERC-8004 identity

The Hedera seller has an on-chain identity in the ERC-8004 Identity Registry on Hedera testnet's EVM (chain 296): [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://hashscan.io/testnet/contract/0.0.7919997) (`0.0.7919997`).

- **Agent `158`.** The seller account `0.0.11337065` registered it. Its EVM address is `0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE`.
  - Registration: [`0xfd8d8683…8235`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xfd8d86838f04ac5fa5791565ac4a53412cbf92105fe5135d079ceb85e92c8235), block 42739726, `SUCCESS`.
  - `ownerOf(158)` on `https://testnet.hashio.io/api` returns that address.
- **The registration file.** It is stored on chain as a `data:` URI of type `registration-v1`, named "Countersign Hedera seller". It lists two endpoints:
  - `A2A`: the hub's agent card;
  - `agentWallet`: `eip155:296:0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE`.
- **One correction.** The first file gave the wallet on Arc's chain (`eip155:5042002`). `setAgentURI` moved it to chain 296: [`0xce2a510d…f12b`](https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xce2a510d6fc7047092c045e02bf4cb7a060113535786af7fc4ab6fa8174cf12b), block 42739948, `SUCCESS`.
- **Not on the hub yet.** The production `/sellers` reads Arc's registry only, so it shows `erc8004: null` for this seller.

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

`agent-run.ts` and `audit.ts` both take `--json`, which prints one evidence object on stdout, in the form `{beat, ok, evidence: [{label, value, url?}]}`. The usual lines go to stderr. The end-to-end suite reads the agent's object. The smoke test appends its own spend to the HCS log, like the agent does.

`setup.ts` is idempotent. Every receiving account must associate the USDC token before it can be paid, or settlement fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`; the script associates both the agent and the seller.

## Notes

- The x402 `SettleResponse` for Hedera names the transaction under `transaction`, in the form `<feePayer>@<seconds>.<nanos>`; `payer` is the paying agent. The mirror node REST form of the same id is `<feePayer>-<seconds>-<nanos>`.
- The `@x402/fetch` client refuses non-default assets by default; the agent allow-lists `0.0.429274` with a per-payment cap through `spendControls`.
- A signed payload names one facilitator's fee payer in its transaction id, so it can only settle through that facilitator. Failover happens when the challenge is issued, never mid-settlement, and the same payment can never land twice.
- Testnet fees observed: creating an account or associating a token costs about 0.8 HBAR at the testnet exchange rate. An HCS message costs about 0.01 HBAR, and the facilitator pays the transfer fee.
- Scheduled checkout fees, from the mirror's charged fees on the traced main run:
  - the agent paid 0.146 HBAR for `ScheduleCreate` and 0.013 HBAR for the scheduled transfer;
  - the seller-sign account paid 0.015 HBAR for `ScheduleSign`.

  The agent pays its own fees here, because no facilitator is in the path.
