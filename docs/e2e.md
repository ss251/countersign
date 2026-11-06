# End-to-end suite

Each flow below runs end to end. Every payment path [status.md](status.md) lists as shipped has a flow here, except the USDT paywall drop-in, which `packages/relay/test/dropin-e2e.test.ts` covers. Where money moves, the test moves real money on a public testnet and then checks the chain itself. The hub's word is never the evidence: a flow passes only when an explorer, an RPC or a mirror node agrees. What the suite does not cover yet is listed at the end.

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
| 13 | `ratings` | a seller's rating and the hub's stats count only what slips prove; the hub's janitor refunds a failed call after its deadline | Arc testnet | orch-cs |
| 15 | `public-hedera` | the Hedera agent pays a live offer on the public hub with no human step; mirror, HCS entry, the hub's settlement and the slip | Hedera testnet | cs-hd |
| 16 | `public-gateway` | a Gateway nanopayment on a live offer of the public hub; balance debited at once, the hub serves the same slip | Arc testnet | orch-cs |
| 17 | `hedera-mcp` | the Hedera agent pays a call to Hedera's own Agent Kit MCP server on the public hub; the slip binds the call, and the returned bytes decode to an unsigned transfer naming the buyer | Hedera testnet | cs-hd |
| 18 | `erc8004-identity` | the Hedera seller's ERC-8004 identity: owner, registration file, the hub card and live offers it names, and the wallet it declares | Hedera testnet | cs-hd |
| 18b | `erc8004-arc` | every seller the public hub names with an ERC-8004 agent id owns it on Arc, its registration names this hub and its own offers, and earned feedback exists | Arc testnet | orch-cs |
| 20 | `hedera-schedule` | on demand: a scheduled Hedera payment executes only on the seller's signature, with exactly the price moved and a `schedule` entry on HCS | Hedera testnet | cs-hd |
| 21 | `hedera-held` | on demand: the agent pays the Agent Kit offer held, its default since #157; the seller's signature executes the schedule, exactly the price moves to the seller's signing account, the slip names the held rail | Hedera testnet | cs-hd |
| 21b | `hedera-held-undelivered` | on demand: the same offer with an input its tool cannot serve; the call fails, the schedule expires unexecuted, the agent releases its hold, and its USDC never moves | Hedera testnet | cs-hd |
| 19 | `mpp` | the MPP rail's Tempo method pays for real on Tempo testnet: the challenge is checked before paying, the receipt, the transfer on chain, a replay refused | Tempo Moderato | cs-hd |
| 14a | `production-console` | the public console's default bundle names the production hub and carries none of the fixture catalogue | none | cs-ui |
| 14b | `production-hub` | every hub endpoint a console screen calls answers 200 on production, open to the console's origin | none | orch-cs |
| 14c | `production-approvals` | the approval routes the buyer's phone reads answer once production has an approver; in progress until then | none | cs-ui |
| 9 | `web` | every route at 390 and 1440 px, light and dark, with no console errors and no clipped nav | none | cs-ui |

Flow 9 needs a browser, and a browser driver for it is cut ([decisions.md](decisions.md), D14): the firstmate's screenshot rounds check the screens by hand in a real browser at 390 and 1440 px, light and dark. The flow reports `NOT RUN (cut: screenshot rounds cover it)`. Its 28 cases stay written in `e2e/flows/web.flow.ts`: the seven routes, each at 390 and 1440 px, light and dark.

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

Flows 6, 15 and 17 pay the exact Hedera rail. Since #157 a plain agent run pays held wherever the hub offers it, at about 0.16 HBAR a purchase, so these flows pass `--exact` and check the 402's `exact` accept by scheme: a held accept may come first, and it pays another account. Until the agent in the branch takes `--exact`, the flag is left out. The held rail has its own flows, 21 and 21b, run on demand.

1. **hub up** with the Hedera rail, and a seller whose offer pays a Hedera account (`runner serve --pay-to hedera=<account>`).
2. **402 names the rail.** The challenge asks for USDC on `hedera:testnet`, paid to the seller's account, with the facilitator's fee payer.
3. **agent pays with no human step.** `scripts/hedera/agent-run.ts --json` finds the offer through the hub, pays it and reports the transaction id, its HashScan link and the spend-log sequence.
4. **mirror confirms.** Read by the suite's own mirror client: the transaction is `SUCCESS`, the agent is debited and the seller credited exactly the price in USDC, and the memo names the offer hash.
5. **spend log entry.** The HCS message at the reported sequence decodes to a `spend` entry for this offer, this amount and this transaction id, submitted by the agent.
6. **envelope refuses past its cap.** The same agent with a cap below what it has spent refuses the call, pays nothing and logs a `refused` entry with reason `over-cap`.
7. **the log is complete for the run.** Every USDC payment the agent made since the flow began is backed by an entry naming its transaction and amount: a `spend`, or a `schedule` whose transfer executed later under the create's id. Every `spend` entry in that window is backed by a payment; `expired` entries move nothing.

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

1. The hub's input gate answers 422 `Refused. The input does not match the offer's schema.`, and the buyer CLI refuses the same input before signing. An input the schema accepts but the slip cannot hash, here a fractional number, gets 422 with no payment terms, while a whole number passes the gate.
2. Over the budget, over the per-seller limit, a seller not on the allowlist, a revoked envelope, and a call above `ask-above` held for the human, each with its own message and reason.
3. With the runner stopped, the hub answers 503 `The seller is offline. Nothing was charged.` and the buyer refuses.

### 12 · public-spine

1. **a live offer**: the public hub lists an online Arc offer at or under 0.05 USDC; the suite recomputes its hash.
2. **envelope approves** and the buyer CLI buys it through the public hub; the hosted relayer pays the gas and the hosted seller's runner delivers.
3. **chain agrees**: `Funded` names this buyer and that seller at the listed price; `Released` carries the slip's hash.
4. **slip verifies with no hub**, and its explorer link opens.

### 13 · ratings

1. **three calls on one offer**: one delivered, one the seller makes to itself, one whose delivery fails.
2. **rating**: `/ratings/<seller>` counts one delivered, one failed and one self-dealt, scores 0.5 over two closed calls, and names one buyer and the delivered volume; `/ratings` agrees.
3. **stats**: `/stats` agrees, with three calls on the escrow rail.
4. **janitor**: after the deadline the hub refunds the failed call itself; the `Refunded` event returns the full price.
5. **rating follows**: the failed call now counts as refunded.

### 15 · public-hedera

1. **a live Hedera offer** on the public hub, and its 402 asks for USDC on `hedera:testnet` paid to the offer's Hedera account.
2. **the agent pays through the public hub** with `scripts/hedera/agent-run.ts --json`, no human step.
3. **mirror**: `SUCCESS`, the agent debited and the payee credited exactly the price, memo naming the offer.
4. **HCS**: the spend entry at the reported sequence names this payment.
5. **the hosted hub** lists the settlement with its slip, serves the slip, and the slip verifies.

### 16 · public-gateway

1. **a live Gateway offer** on the public hub; the buyer CLI pays it with `--rail gateway`.
2. **debited at once**: the buyer's Gateway balance drops by exactly the price.
3. **the hosted hub serves the same slip**, rail `gateway`, and it verifies.

### 17 · hedera-mcp

The offer is Hedera's Agent Kit MCP server, `@hashgraph/hedera-agent-kit-mcp` 1.2.0, run by the seller's runner in RETURN_BYTES mode with no operator key. Its tool is `transfer_hbar_tool`.

1. **the offer**: the public hub lists it, found at run time by adapter `mcp` and seller. Its 402 asks for USDC on `hedera:testnet`.
2. **the agent pays** with `scripts/hedera/agent-run.ts --offer <hash> --input <the tool's arguments>`, no human step.
3. **mirror and HCS**: the payment is `SUCCESS`, moving exactly the price, and the spend entry names it.
4. **the slip binds the call**: its `inputHash` is the hash of the tool's arguments, and its `outputHash` is the hash of the call record (tool, server, package and version, input hash, result). The public hub lists the settlement, and the slip verifies.
5. **the result is real**: the returned bytes decode, with the Hedera SDK, to a `TransferTransaction` whose transaction id names the buyer, carrying the memo and the HBAR legs that were sent and no signature.

Until the agent's `--offer` flag is in the branch (#42), the flow reports NOT RUN.

### 18 · erc8004-identity

Reads only, over Hedera's JSON-RPC relay, from the IdentityRegistry `0x8004A818…BD9e` on chain 296.

1. **owner**: the agent id's owner is the seller's EVM key.
2. **registration**: the agent URI is an ERC-8004 v1 file that declares reputation trust and names at least one offer.
3. **A2A**: its A2A endpoint is the public hub's agent card, which answers and lists the registered offers.
4. **offers**: every registered offer is listed, online, and sold by the agent's owner.
5. **wallet**: the registry's agent wallet is the owner, and the file's `agentWallet` endpoint names that account on the chain the identity lives on.

### 18b · erc8004-arc

Reads only, on Arc, from the IdentityRegistry and the ReputationRegistry `0x8004B663…8713`.

1. **identities**: every seller the public hub's `/sellers` names with an ERC-8004 agent id; the registry is the one the hub names.
2. **ownership and registration**: each agent id is owned by its seller on Arc. Its registration file is v1, names this hub's agent card, declares its wallet as `eip155:5042002:<seller>`, and every offer it registers is the seller's own.
3. **earned feedback**: every `NewFeedback` for these agents since the hub's start block is read. Feedback counts as earned only when its hash is a slip the hub serves for that seller and the client who gave it is that slip's buyer. At least one earned feedback must exist.

### 20 · hedera-schedule (on demand)

About 0.18 HBAR a run, so the hourly run skips it as `NOT RUN (on demand)`; `bun run e2e -- --flow hedera-schedule` runs it. cs-hd's `scripts/hedera/schedule.ts --json` creates a scheduled 0.01 USDC payment from the agent to a seller account that requires its own signature, and the seller signs only after checking the scheduled body strictly.

1. **the script**: ok, mode `main`, its audit matched 1, unbacked 0, unlogged 0.
2. **mirror, schedule**: executed, payer the agent, `wait_for_expiry` false.
3. **mirror, transfer**: the scheduled `CRYPTOTRANSFER` succeeded and moved exactly 0.01 USDC from the agent to one account.
4. **HCS**: the `schedule` entry names the schedule, the create transaction and the amount, written by the agent.

The expiry path, where nothing moves, is flow 21b.

### 21, 21b · hedera-held (on demand)

About 0.16 HBAR a purchase, so the hourly run skips both as `NOT RUN (on demand)`. Both pay production's Agent Kit offer (17's seller), which lists `hedera-scheduled` first: the agent creates a scheduled USDC transfer to the seller's signing account, and nothing moves until the seller signs it after a checked delivery. Both report NOT RUN while production does not declare `hedera-scheduled` or the offer does not list it first, and while the agent in the branch has no held path.

Both first check the same three things:

1. **production declares the held rail** in `/rails`.
2. **the offer lists it first** and keeps the exact Hedera rail beside it; it hashes to its offer hash, and its `hedera-scheduled` payee is an account.
3. **the 402 offers both payments.** The held accept (scheme `countersign`, `extra.name` `hedera-scheduled`) pays the offer's held payee exactly the price in USDC, with the offer's hash, the offer's deadline as its timeout, and a hold of the deadline plus 180 s. The exact accept still pays the offer's Hedera account.

21, `--flow hedera-held`:

4. **the agent pays held, its default**, with no human step. Its payment is the schedule's create, it reports the hold's HCS entry and the slip, and it saw the schedule execute.
5. **mirror, schedule**: executed, created and paid for by the agent, not waiting for expiry, not deleted.
6. **mirror, transfer**: the scheduled `CRYPTOTRANSFER` succeeded and moved exactly the price from the agent to one account, the held payee.
7. **HCS**: the `schedule` entry names the schedule, the create, the amount, the payee and the offer, written by the agent.
8. **the slip**: the public hub serves it, rail `hedera-scheduled`, its input hash is the tool's arguments, its settlement is the schedule's create, and it verifies. Until #163 is fixed the verifier calls a held slip INVALID, so this step is red.

21b, `--flow hedera-held-undelivered`, about seven minutes, since it waits out the hold. The input is cs-hd's `{"transfers":[{"accountId":"not-an-account","amount":1}]}`, which the offer's schema takes and the Agent Kit tool cannot serve.

4. **the call fails and the hold is released**: `agent-run.ts --prove-undelivered` succeeds. The hub did not answer 200, the agent saw no execution, it released the hold once the schedule expired, its USDC balance is the same before and after, and it logged an `expired` entry.
5. **mirror, schedule**: never executed, created by the agent, and past its expiry.
6. **mirror, transfer**: no scheduled transaction exists for the create.
7. **HCS**: the `schedule` entry and the `expired` entry name the same schedule and create, both written by the agent.

### 19 · mpp

The demo server (`scripts/mpp/server.ts`) runs the countersign `mpp` rail on Tempo Moderato (chain 42431). That is the logic the hub will use; the hub's MPP wiring is not built yet. The project payer pays with the pinned `mppx` 0.17.1, always named by `--account`, with the Stripe CLI off `PATH` and no Stripe or mppx variables in the child's environment.

1. **the challenge first**: the 402's `WWW-Authenticate: Payment` challenge must name method `tempo`, 10000 pathUSD, the project recipient, chain 42431 and the offer hash before anything is allowed to pay.
2. **paid**: `mppx` pays `GET /rail/paid`. The answer is 200 with the Tempo transaction, and its `Payment-Receipt` says `tempo`, `success`, with that transaction as `reference`.
3. **chain**: on the Moderato RPC, the receipt is a success, and exactly 10000 pathUSD moved from the payer to the recipient.
4. **replay refused**: a credential signed with `mppx sign` is accepted once and refused with 409 `replay` the second time. The credential is held in memory only, never written to a log.

### 14a, 14b · production smoke

Plain HTTP against the public console and hub, every hour. They exist to fail loudly if production slides back to fixtures.

1. **console**: the index and every module script it loads are fetched as text. The default bundle must contain the production hub's URL. It must also contain none of the fixture-only values: addresses and hashes found in the fixture files and nowhere else in the repository, collected fresh on each run.
2. **hub**: production declares escrow, Gateway, Hedera and Whitechain. Every endpoint the overview, registry, offer page, assistant, buyer phone, seller dashboard, merchant desk and slip screens call answers 200. The agent is named after the latest settlement's buyer, as the console does. Each answer is open to the console's origin. One failure message lists every endpoint that fails.
3. **approvals (14c)**: the approval routes, `/envelopes` and `/approvals`, depend on production's approver configuration. While production answers 503 `no-approver`, the flow reports `NOT RUN (in progress)`. With an approver configured:
   - without the human's token every route answers 401;
   - with the token, as the console sends it, `/approvals` answers 200 and a published envelope mirror answers 200;
   - an agent with no mirror gets the documented 404 `unknown-agent`, which the phone shows as an honest absence;
   - the decision route passes CORS preflight with an `authorization` header.

   The token is read from a local env file and never logged.

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

## Not covered yet

These parts of the product have no end-to-end flow:

- the MPP rail's Stripe card method (behind a flag; the Tempo method is flow 19), and MPP through the hub;
- receipt trees and lineage;
- ENS seller names;
- the mainnet guard;
- the Escrow v2 review window, dispute and bond.

The web routes are cut from the suite; the firstmate's screenshot rounds check them. A part moves into the flows table only once its flow passes.
