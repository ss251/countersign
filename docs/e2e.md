# End-to-end suite

Every flow countersign claims has a test here. Where money moves, the test moves real money on a public testnet and then checks the chain itself. The hub's word is never the evidence: a flow passes only when an explorer, an RPC or a mirror node agrees.

```
bun run e2e                      # every flow, in order
bun run e2e -- --flow arc-spine  # one flow, plus the flows it needs
bun run e2e -- --list            # flows, owners and what each spends
bun run e2e -- --dry             # balance check only, spends nothing
```

The last full run is in [`e2e/runs/LATEST.md`](../e2e/runs/LATEST.md).

## Flows

| # | Flow | Proves | Network | Owner |
|---|---|---|---|---|
| 1 | `arc-spine` | discovery, envelope, countersign, fund, deliver, release; the slip verifies with the hub stopped | Arc testnet | orch-cs |
| 1b | `runner-restart` | a seller's runner stops and starts again; its offer keeps its hash and comes back online | none | orch-cs |
| 2 | `arc-wrong-amount` | a settlement at another price is refused by the hub and reverted by the chain | Arc testnet | orch-cs |
| 3 | `arc-deadline-refund` | the seller fails to deliver; after the deadline a stranger refunds the full amount, with no hub running | Arc testnet | orch-cs |
| 4a | `slip-onchain-arc` | the `Released` event carries the slip's hash; a tampered slip whose own hash still matches fails | Arc testnet | orch-cs |
| 4b | `slip-onchain-whitechain` | the same check on the escrow on chain 1874 | Whitechain Sepolia | cs-wc |
| 5 | `whitechain` | a buyer holding zero WBT pays in USDT through the relayer; the merchant refunds in one click | Whitechain Sepolia | cs-wc |
| 6 | `hedera` | an agent pays a hub offer over x402 with no human step; the payment is on the mirror node and in the HCS spend log | Hedera testnet | cs-hd |
| 7 | `merchant` | totals, a partial refund and the accountant export agree with the chain | Whitechain Sepolia | cs-wc |
| 8 | `discovery` | the A2A card, skills index, OpenAPI document and offer list resolve from a clean client, locally and on the public hub | none | orch-cs |
| 10 | `arc-gateway` | the buyer pays from its Circle Gateway balance: debited at once, slip names the gateway rail | Arc testnet | orch-cs |
| 11 | `refusals` | the input gate, every envelope limit and an offline seller stop a call before anything is signed | none | orch-cs |
| 12 | `public-spine` | a buyer on this machine pays a live offer on the public hub; the slip verifies with no hub | Arc testnet | orch-cs |
| 9 | `web` | every route at 390 and 1440 px, light and dark, with no console errors and no clipped nav | none | cs-ui |

Flow 9 needs a browser. Browsers are not run on the build machine, so it reports `NOT RUN (browser rule)` until a driver is approved. Its cases are listed by `--list`.

## What each flow asserts

Each flow is a list of named steps. The first failed step ends the flow, names itself in the summary and keeps its artifacts. Processes the flow started are always stopped.

### 1 · arc-spine

1. **hub up.** A fresh hub on its own port and database, escrow rail on Arc, gas paid by the suite's own submitter. `/healthz` lists the escrow rail at the pinned escrow address.
2. **seller publishes.** The runner CLI serves Circle's `use-arc` `SKILL.md` at 0.01 USDC. The offer is listed and online.
3. **buyer discovers.** `buyer discover` prints the offer.
4. **envelope approves.** `buyer envelope set` writes a cap, a per-seller limit and an allowlist naming the seller.
5. **countersign, fund, deliver, release.** `buyer buy` exits 0 and prints `Released. Slip minted.` The journal records `countersigned`, `signed` and `released` for one job id.
6. **chain agrees.** Read from Arc, not the hub: the fund transaction emits `Funded` with the buyer, payee, amount and deadline the buyer signed; the release transaction emits `Released` with `paid + toll = amount` and the toll equal to `tollOf(amount)`; `jobOf(jobId)` is `Released` and stores the slip hash; the seller's balance rose by exactly `paid`.
7. **slip names its rail.** The slip the buyer saved equals the hub's copy, names rail `escrow`, and its settlement is the release transaction.
8. **hub stopped.** The hub process exits and its port refuses connections.
9. **verifier VALID.** `packages/verify` with only the slip file and a public RPC prints `VALID`, with `hash`, `seller`, `terms`, `countersignature` and `onchain` all `ok`.

### 1b · runner-restart

1. **runner serves** `use-arc` with its own state directory; the offer is listed and online.
2. **runner stops**; the hub lists the offer offline.
3. **runner restarts** with the same state. It republishes the same offer hash and the hub lists it online again.

### 2 · arc-wrong-amount

1. **challenge.** An unpaid call answers 402; the `PAYMENT-REQUIRED` header decodes to the body; the countersign entry asks for the listed price at the pinned escrow.
2. **hub refuses.** The buyer countersigns the listed price; the payment is resent claiming twice the price. The hub answers `Refused. The price moved after you signed.` and no job exists on chain.
3. **chain refuses.** A stranger submits `fund` at twice the price with the buyer's real signature, skipping gas estimation so the transaction is mined. Its receipt is `reverted`, it carries no `Funded` and no token transfer, and replaying it as a call decodes `CountersignatureMismatch`.
4. **signature was good.** The same `fund` at the signed price succeeds as a call (not sent), so the refusal is the price and nothing else.

### 3 · arc-deadline-refund

1. **hub and seller up**, with a 45-second delivery deadline.
2. **buyer pays, seller cannot deliver.** The buyer asks for a section the skill does not have. The runner refuses, the hub answers `Refused. The seller's output does not match the offer. Your money returns at the deadline.` and the buyer CLI exits 1.
3. **escrow holds it.** `jobOf(jobId)` is `Funded` for the signed amount and deadline.
4. **hub stopped**, so its own refund sweep cannot run.
5. **too early is refused.** A refund before the deadline fails as a call with `DeadlineNotReached`.
6. **stranger refunds.** Once an Arc block is past the deadline, an account that is neither buyer, seller nor hub sends `refund`. The receipt emits `Refunded(jobId, buyer, amount, false)` and moves the full amount from the escrow to the buyer.
7. **refund is final.** A second refund fails as a call with `NotFunded`.

### 4a, 4b · slip-onchain

Uses the released slip from flow 1 (Arc) or flow 5 (Whitechain).

1. **event carries the hash.** Exactly one `Released` log for the job; its `slipHash` equals the hash computed here from the slip body.
2. **escrow agrees.** `jobOf(jobId).slipHash` is the same hash.
3. **genuine slip valid.** The verifier prints `VALID`.
4. **tampered slip fails.** One body field is changed and the slip's hash recomputed, so the slip agrees with itself. The verifier prints `ok hash`, `FAIL onchain` and `INVALID`.

### 5 · whitechain

1. **relay, merchant server, hub and seller up**, each with only its own key, on the suite's own relayer wallet.
2. **buyer holds no gas.** The buyer's WBT balance and transaction count on chain 1874 are both zero.
3. **buyer pays in USDT.** The buyer CLI buys the `whitechain-dev` skill. Released, slip minted.
4. **chain agrees.** The fund and release transactions were sent by the relayer, not the buyer; USDT moved from the buyer to the escrow and on to the merchant; the buyer still has zero WBT and zero transactions.
5. **merchant sees the order** in its own ledger, with both transactions.
6. **merchant refunds in one click.** `POST /orders/:id/refund` with the merchant's token returns a transaction the relayer sent; USDT moves from the merchant back to the buyer; the order reads `refunded`; the buyer still holds no WBT and has sent no transaction.

### 6 · hedera

1. **hub up** with the Hedera rail, and a seller whose offer pays a Hedera account (`runner serve --pay-to hedera=<account>`).
2. **402 names the rail.** The challenge asks for USDC on `hedera:testnet`, paid to the seller's account, with the facilitator's fee payer.
3. **agent pays with no human step.** `scripts/hedera/agent-run.ts --json` finds the offer through the hub, pays it and reports the transaction id, its HashScan link and the spend-log sequence.
4. **mirror confirms.** Read by the suite's own mirror client: the transaction is `SUCCESS`, the agent is debited and the seller credited exactly the price in USDC, and the memo names the offer hash.
5. **spend log entry.** The HCS message at the reported sequence decodes to a `spend` entry for this offer, this amount and this transaction id, submitted by the agent.
6. **envelope refuses past its cap.** The same agent with a cap below what it has spent refuses the call, pays nothing and logs a `refused` entry with reason `over-cap`.

### 7 · merchant

1. **payment lands.** The buyer buys a 0.02 USDT skill from the merchant through the hub and the relay.
2. **totals.** The merchant view's own `totals()` over the merchant's orders gives received, fees and net that match the chain: the fee is the toll in the `Released` event.
3. **partial refund.** A refund of part of the order returns that transaction and `remaining`; the chain shows exactly that amount going back; the order reads `partially_refunded`.
4. **totals move.** Refunded rises and net falls by the refunded amount, nothing else.
5. **export.** `orders.csv` has the documented header and a row for the order whose amounts and explorer links match the chain.
6. **no token, no refund.** The same refund without the merchant's token is refused with 401.

### 8 · discovery

Runs against the suite's own hub and, when set, the public hub. A clean client is plain HTTP with no cookies and no state.

1. `/healthz` is `ok`.
2. `/.well-known/agent-card.json` and `/.well-known/agent.json` are identical, name the hub's public URL, and list one skill per offer; the interfaces they advertise resolve.
3. `/.well-known/skills/index.json` lists every skill offer with its call URL and price.
4. `/openapi.json` is OpenAPI 3.1 with the hub as its server and a call path per offer.
5. `/discovery/resources` lists the offers in x402 v2 form.
6. `/offers`: every listed offer hashes to its own `offerHash`, recomputed here.
7. An unpaid call answers 402 with the bazaar extension.

### 10 · arc-gateway

1. **hub up** with the escrow and Gateway rails; the seller lists one offer on both.
2. **402 offers Gateway**: an `exact` entry for `GatewayWalletBatched` at the price, paid to the seller, beside the escrow entry.
3. **buyer pays through Gateway** (`buy --rail gateway`); the journal records `settled` on rail `gateway`.
4. **debited at once**: the buyer's Gateway balance drops by exactly the price. The seller is credited in Gateway's next batch, so there is no per-call chain transaction to check.
5. **slip** names rail `gateway`, no escrow, carries the Gateway transfer id, equals the hub's copy and verifies.

### 11 · refusals

Each case uses a fresh buyer state and must end with a refusal in the journal and no `signed` entry.

1. The hub's input gate answers 422 `Refused. The input does not match the offer's schema.`, and the buyer CLI refuses the same input before signing.
2. Over the budget, over the per-seller limit, a seller not on the allowlist, a revoked envelope, and a call above `ask-above` held for the human, each with its own message and reason.
3. With the runner stopped, the hub answers 503 `The seller is offline. Nothing was charged.` and the buyer refuses.

### 12 · public-spine

1. **a live offer**: the public hub lists an online Arc offer at or under 0.05 USDC; the suite recomputes its hash.
2. **envelope approves** and the buyer CLI buys it through the public hub; the hosted relayer pays the gas and the hosted seller's runner delivers.
3. **chain agrees**: `Funded` names this buyer and that seller at the listed price; `Released` carries the slip's hash.
4. **slip verifies with no hub**, and its explorer link opens.

## Results

| Status | Meaning |
|---|---|
| `PASS` | every step passed |
| `FAIL` | a step failed; the summary names it and the artifacts keep the evidence |
| `SKIPPED (funds)` | a paying wallet would drop below its floor; nothing was spent |
| `NOT RUN (<reason>)` | the flow cannot run here, or a flow it needs did not pass |

Each run writes `e2e/runs/<run-id>.md` with every flow's status, duration, failed step and transactions with explorer links. A full run also refreshes `e2e/runs/LATEST.md`. Request and response bodies, process logs and slips stay under `e2e/artifacts/<run-id>/<flow>/`, which is not committed.

A test that fails is not edited to pass. A product bug goes to the owning lane and the flow stays red until it is fixed.

## Money

- **Budget guard.** Before anything is spent, the suite reads every paying wallet. A flow that would take one below its floor is `SKIPPED (funds)`, and the run asks for a faucet top-up naming the address.
- **Keys.** Testnet keys are read at run time from env files outside the repository. Each child process receives only the key it needs, by environment, never in argv. Every artifact is scrubbed of key material before it is written.
- **Re-runnable.** Every run uses fresh offers, salts and job ids, and cleans up nothing on chain.
- **Own wallets for gas.** The suite submits through its own hub and relay with its own gas wallets, so it never races another process for a nonce.
- **Own state per flow.** Each runner gets its own state directory, so another runner on the machine never changes what a flow publishes.
- **Testnets only.** Arc testnet (5042002), Whitechain Sepolia (1874), Hedera testnet.

## Schedule

A full run goes through the shared gate lock about once an hour from a clean checkout of `cs/e2e`. Its summary is committed and becomes `LATEST.md`; a new failure, or a flow that passes again, is posted to the owning lane.
