<p><img src="marks/countersign-wordmark.svg" alt="countersign" height="40"></p>

countersign lets a software agent pay for a call to another piece of software with one signature that binds the offer, the payee and the amount, and hands it back a receipt that proves itself without the hub.

## Rails

One interface, one slip shape. Nothing above a rail knows which chain it is on ([docs/spec/rail.md](docs/spec/rail.md)).

| Rail | Network | Token | Kind | Status |
|---|---|---|---|---|
| Arc | Arc testnet, chain `5042002` | USDC `0x3600000000000000000000000000000000000000` | escrow | Live. [Paid release](https://explorer.testnet.arc.io/tx/0x02b65aabec26062e828e1b91203a9d8de5cdab0a6717bbf087054c76b3702809), more in [docs/proof.md](docs/proof.md). |
| Whitechain | Whitechain Sepolia, chain `1874` | USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | escrow, relayer pays gas | Live on testnet. [Fund](https://explorer.testnet.whitechain.io/tx/0x415bddc897b459a2d2342809e1a2621ac3999ca1d5812b3670b563fce504b08c), [release](https://explorer.testnet.whitechain.io/tx/0x90ed826a41f21290db924e4afc1e06bffe806e2966d8582618a074efa0c3c812), [merchant refund](https://explorer.testnet.whitechain.io/tx/0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5). The rail and relay code are in review in [#17](https://github.com/ss251/countersign/pull/17). |
| Hedera | Hedera testnet, `hedera:testnet` | HTS USDC `0.0.429274` | direct, x402 v2 `exact` through a hosted facilitator | Live. [Agent-paid call](https://hashscan.io/testnet/transaction/0.0.9185802@1793959685.864333631), see [Hedera payment flow](#hedera-payment-flow). |
| Stripe MPP | `mpp:stripe` | | | In progress, built against a mock until test keys arrive ([#5](https://github.com/ss251/countersign/issues/5)). Not live. |

A Circle Gateway rail (batched nanopayments on Arc testnet) runs in the hub behind `GATEWAY_RAIL=1`. Gateway debits the buyer at once and credits the seller in a later batch, so a nanopayment has a Gateway transfer id, not a per-call chain transaction. The first one, 0.01 USDC, is transfer `a69f94c8-8771-4d8b-96ba-fe189501f80c`, after a [1 USDC deposit](https://explorer.testnet.arc.io/tx/0x4ae047192cda083df967bfe371359dd4f4a7bfde7cde1f61ea9b2a9ddab91cbc) ([docs/proof.md](docs/proof.md)).

## Live links

- Repository: https://github.com/ss251/countersign
- Console: [web-production-a58de.up.railway.app](https://web-production-a58de.up.railway.app)
- Hub: [hub-production-e85e.up.railway.app](https://hub-production-e85e.up.railway.app/healthz). A purchase through it [released on Arc](https://explorer.testnet.arc.io/tx/0x0a0118e9e81c21517eaf0f387e7801e1fafef947cfccd1c05ff989201433ed69), slip `0x3204ff870ffad20b38d9504622e5889508d889a10f3f1efef05d16046ab2fe85`.
- Arc Studio project: `https://studio.arc.io/app/16e0b317-ec5f-406a-8d7d-24bf6d96533b`. It opens only when signed in to Studio ([docs/decisions.md](docs/decisions.md), D6). The Railway console above is the logged-out view.
- Arc escrow, deployed through Arc Studio: [`0x19c27d770969291e6a0a305dc1be1a845e7c1b76`](https://explorer.testnet.arc.io/address/0x19c27d770969291e6a0a305dc1be1a845e7c1b76)
- Whitechain escrow: [`0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4`](https://explorer.testnet.whitechain.io/address/0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4)
- Hedera spend log: HCS topic [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070)
- More proofs with explorer links: [docs/proof.md](docs/proof.md) for Arc and Gateway, [docs/hedera.md](docs/hedera.md) for Hedera.

## How it works

1. **The offer.** A seller publishes a signed offer: price, input and output schema, delivery deadline and the rails it accepts. `offerHash` is the keccak256 of its canonical JSON, so any change, the price included, is a new offer with a new hash ([offer.md](docs/spec/offer.md)).
2. **The envelope.** The human sets the agent's limits: a total budget cap, a per-merchant limit, an allowlist, an ask-above threshold, and revoke. The agent checks them, then reserves the spend in its journal, before it signs anything ([envelope.md](docs/spec/envelope.md)). A refusal reads, for example, "Refused. This would spend 5.000001 of a 5 budget."
3. **The countersignature.** The buyer signs one message. On escrow rails it is the token's EIP-3009 `ReceiveWithAuthorization`, whose nonce is the `jobId` derived from the offer hash, buyer, payee, amount, deadline and salt under the escrow's EIP-712 domain. Change any of them and the signature no longer matches ([countersignature.md](docs/spec/countersignature.md)).
4. **The escrow.** `CountersignedEscrow` pulls the amount on `fund`, pays the seller on `release` with the seller's signature over the slip hash, and returns the full amount to the buyer on `refund` after the deadline or on the seller's `cancel`. It has no owner, no pause and no proxy ([escrow.md](docs/spec/escrow.md)).

A moved price reverts on chain: [Arc, price moved](https://explorer.testnet.arc.io/tx/0xca61627848d1ea952c5953ac58df7b8bd780777563e24ebccf5bb90315d20e76). A missed deadline refunds the buyer in full: [fund](https://explorer.testnet.arc.io/tx/0x6a103973020747af341e008ec5b317cc97ac0ffef059c381fb19d9cdf9ca2eb7), [refund](https://explorer.testnet.arc.io/tx/0x1cd2a5a624a6c166d6b85e99dfaffcbd03c1c65c17fe7010109610872c499e35).

## The receipt

A released call leaves a slip: `{body, hash, sellerSig, payment, settlement}` ([slip.md](docs/spec/slip.md)). The body holds the rail, offer hash, job id, parties, amount, the hashes of the input and output, the delivery time and, on escrow rails, the escrow and chain.

A verified slip proves:

- **hash:** `hash` is the keccak256 of the canonical body, so it commits to every field.
- **seller:** the seller's EIP-712 `Release(jobId, slipHash)` signature recovers to the seller named in the body.
- **terms and countersignature:** the buyer's countersigned terms derive the body's `jobId`, and the buyer's signature recovers to the buyer.
- **on chain:** with an RPC URL, the escrow's `Released(jobId, slipHash)` event carries this slip's hash. The committed hash covers the body without the settlement receipt, because the release transaction cannot exist before the hash it commits ([decisions.md](docs/decisions.md), D9). A tampered body with a recomputed hash still fails, because the chain holds the original.

The verifier imports nothing from the hub. Without `--rpc` it proves who signed what and says the chain was not read.

## Hedera payment flow

An agent pays on Hedera testnet over x402 v2, through a hosted facilitator, with no human in the loop. Traced through one real payment, from [docs/hedera.md](docs/hedera.md):

The agent `0.0.11337064` bought one call for 0.01 USDC from a seller paid at `0.0.11337065`, with no human approving. Every value below was read back from Hedera testnet.

1. **Discover.** The agent lists offers with `GET /offers` and picks one that settles on the `hedera` rail: offer `0x3be64f4c…8d3b`.
2. **Challenge.** The hub answers `402` with x402 v2 payment requirements:
   - `scheme: exact` and `network: hedera:testnet`;
   - `asset: 0.0.429274` (USDC) and `amount: 10000` (0.01 USDC);
   - `payTo: 0.0.11337065`;
   - `extra.feePayer: 0.0.9185802`, the x402.org facilitator's account, read live from its `GET /supported`.
3. **Envelope.** Before signing, the agent checks its envelope. The cap was 0.025 USDC and 0.01 USDC was already spent, a total the agent rebuilds from its own HCS log. The call fits, so it is approved.
4. **Countersign.** The agent signs one Hedera `TransferTransaction`: `-10000` from itself and `+10000` to the seller on token `0.0.429274`, with memo `cs1:3be64f4c…8d3b`. One signature binds all three:
   - the memo binds the offer;
   - the transfer list binds the amount and the payee;
   - the transaction id names the facilitator as fee payer, so the agent never pays gas.
5. **Verify.** The hub's hedera rail decodes the transfer and checks it before any facilitator sees it: exactly one debit and one credit, the exact amount and payee, the offer memo, the payer's signature against its on-chain key, and a validity window no longer than the offer allows. Then it asks the facilitator's `POST /verify`.
6. **Settle.** The facilitator adds its fee-payer signature and submits. Transaction [`0.0.9185802@1793959685.864333631`](https://hashscan.io/testnet/transaction/0.0.9185802@1793959685.864333631) reached consensus at `1793959695.377881104` with result `SUCCESS`. The agent was debited 0.01 USDC and the seller credited 0.01 USDC, and the facilitator paid the 0.0162 HBAR network fee.
7. **Log.** The agent appended the spend to its HCS topic [`0.0.11337070`](https://hashscan.io/testnet/topic/0.0.11337070) as [message #3](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/3), at consensus `1793959697.058168104`. The entry names the offer, the payee, the amount and the transaction.
8. **Refuse.** A second call would have spent 0.03 of the 0.025 cap. The agent refused before signing anything: "Refused. This would spend 0.03 of a 0.025 budget." The refusal is logged too, as [message #4](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.11337070/messages/4).
9. **Audit.** Anyone can replay the topic from the mirror node and match each spend to its transfer: `bun scripts/hedera/audit.ts`.

Two refusals protect the money.

- **A price that moves after signing cannot settle.** The signed amount no longer equals the requirement, so the rail refuses before settlement, and the facilitator's exact-amount rule would refuse it again.
- **A replayed payment is refused.** The rail claims each transaction id once before any facilitator call. When a facilitator does not answer, only a consensus that happened after the attempt counts as settled.

This run used `scripts/hedera/hub-standin.ts`, a one-offer stand-in hub that runs the same `createHederaRail()` the hub runs with `HEDERA_RAIL=1`. The same transaction on the mirror node: [`0.0.9185802-1793959685-864333631`](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.9185802-1793959685-864333631).

## Run it from a clean clone

You need [bun](https://bun.sh) 1.3 and [foundry](https://getfoundry.sh). The gate:

```sh
git clone https://github.com/ss251/countersign.git
cd countersign
bun install --frozen-lockfile
bun run gate          # typecheck, bun test, forge test
bun run web:build
```

A hub on Arc testnet, using public values only:

```sh
PORT=8787 \
ARC_ESCROW=0x19c27d770969291e6a0a305dc1be1a845e7c1b76 \
ARC_RPC_URL=https://rpc.testnet.arc.network \
bun run hub
curl -s http://127.0.0.1:8787/rails
```

A seller serving a catalogue skill, in a second terminal. The runner reads its key from `CS_SELLER_KEY`; this makes a throwaway one:

```sh
export CS_SELLER_KEY=$(cast wallet new --json | jq -r '.[0].private_key')
bun packages/runner/src/cli.ts serve --hub http://127.0.0.1:8787 \
  --skill examples/catalogue/circle/use-arc/SKILL.md --price 10000
```

A buyer agent, in a third terminal. Its key comes from `CS_BUYER_KEY`, and its envelope and journal live in `~/.countersign`:

```sh
export CS_BUYER_KEY=<a testnet key>
bun packages/buyer/src/cli.ts discover --hub http://127.0.0.1:8787
bun packages/buyer/src/cli.ts envelope set --cap 1 --per-merchant 0.5
bun packages/buyer/src/cli.ts buy <offerHash> --input '{}' --hub http://127.0.0.1:8787
```

With an unfunded key the buy stops before payment: "Refused. The buyer cannot cover this amount." A paid run needs Arc testnet USDC on the buyer key and a `CS_RELAYER_KEY` on the hub, which submits the escrow transactions and pays their gas in USDC.

Verify any slip, from a hub or from `~/.countersign/slips/`. This one is the hosted purchase above:

```sh
curl -s https://hub-production-e85e.up.railway.app/slips/0x3204ff870ffad20b38d9504622e5889508d889a10f3f1efef05d16046ab2fe85 > slip.json
bun packages/verify/src/cli.ts slip.json --rpc https://rpc.testnet.arc.network
```

The console: `bun run --cwd apps/web dev`.

Hub environment: `PORT`, `HUB_DB` (SQLite path), `HUB_PUBLIC_URL`, `ARC_ESCROW`, `ARC_RPC_URL`, `CS_RELAYER_KEY`, `GATEWAY_RAIL=1`, `HEDERA_RAIL=1`. The Hedera scripts and their keys are described in [docs/hedera.md](docs/hedera.md#setup).

## Repository map

| Path | What |
|---|---|
| `apps/hub` | The hub: offers, 402 challenges, jobs, slips, discovery, runner connections. |
| `apps/web` | The console. |
| `packages/core` | Types, canonical JSON, offer, countersignature, envelope, slip. The reference for `docs/spec`. |
| `packages/rail` | The `Rail` interface and the escrow, Gateway and Hedera rails. |
| `packages/buyer` | The buyer agent and its CLI. |
| `packages/runner` | The seller's runner and its CLI. |
| `packages/verify` | The standalone slip verifier. |
| `packages/relay` | The Whitechain gas relay (lands with [#17](https://github.com/ss251/countersign/pull/17)). |
| `contracts/` | `CountersignedEscrow`, `FeeSplit`, Foundry tests, deployments. |
| `docs/` | `spec/`, `decisions.md`, `proof.md`, `hedera.md`. |
| `examples/catalogue` | The sponsor skills the demo sellers serve, unmodified, with upstream and licence. |
| `scripts/` | Hedera setup, agent run and audit; Gateway deposit and balance. |
| `marks/` | The mark and wordmark. |

## Architecture

The seller's runner dials out to the hub and publishes signed offers. The buyer agent finds an offer, checks it against its envelope and its pinned rail table, and countersigns. The hub verifies and settles through the rail named in the payment, sends the call to the runner, checks the output against the offer's schema, and on an escrow rail releases with the seller's signature over the slip hash. The buyer keeps the slip, and anyone can verify it against the chain.

```
 human ── envelope ──▶ buyer agent ◀──────── slip ────────┐
                          │                                 │
           GET /offers, 402, countersignature               │
                          ▼                                 │
 seller runner ◀── call / output, Release sig ──▶ hub ──────┘
   (dials out,                                     │
    signs offers)                                  │ verify, settle, release
                                                   ▼
                                                 rail ── Arc         CountersignedEscrow, USDC
                                                      ── Whitechain  CountersignedEscrow, USDT
                                                      ── Hedera      x402 facilitator, HTS USDC

 slip ──▶ packages/verify ──▶ Released(jobId, slipHash) read from the chain
```

## Safety limits

- **Testnet only.** Every deployment and payment above is on a testnet. There is no mainnet configuration.
- **Keys stay on the device.** The buyer and seller read their keys from the environment, and the hub holds no buyer key. On escrow rails the hub can submit the buyer's countersignature, but the signature fixes the escrow, payee and amount.
- **What the escrow protects against:** a moved price, a swapped payee or offer, an extended deadline, replay of one countersignature, and a seller who never delivers, which the buyer recovers by refund after the deadline.
- **What it does not protect against:** release needs only the seller's signature, so the escrow pays a funded job whenever the seller signs a release before the deadline. It cannot judge the output. The hub's output-schema check is the delivery gate, and it sits off chain.
- **Post-delivery collusion.** Once released, nothing on chain reverses a payment. A seller, alone or together with the hub, can release against output the buyer did not get or cannot use. The slip's `outputHash` is the buyer's evidence of what it was given, not a remedy.
- **The bond is declared, not held.** No contract collects it.
- **Token blocklists.** If the token blocklists the treasury, releases revert until the deadline and buyers recover by refund. If it blocklists a buyer, refunds to that buyer revert ([escrow.md](docs/spec/escrow.md#known-limits)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT, see [LICENSE](LICENSE). Catalogue items keep their upstream licences, listed in [NOTICE](NOTICE).

## Built during the event

<!-- written by the captain -->
