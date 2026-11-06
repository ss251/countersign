# Interop

What a client that is not countersign's own buyer needs in order to read a hub, pay it, and check what it got. It covers x402 v2 clients, Circle's tooling, Hedera facilitators, and writing your own buyer. Field-by-field formats are in [spec/](spec/README.md); this page says which parts other software can use.

## In one table

| You have | You can | You cannot |
|---|---|---|
| Any x402 v2 client | Read the 402. Pay an `exact` option: Gateway (`GATEWAY_RAIL=1`) or Hedera. | Pay a `countersign` option without implementing the countersignature |
| An x402 Bazaar reader, such as the Circle CLI | List and inspect a hub's offers, as for Circle's own catalogue | Place a testnet hub in Circle's public catalogue: services enter it through the facilitator that settles them |
| An A2A or OpenAPI client | Read the agent card, skills index or OpenAPI document | |
| A slip and, optionally, an RPC URL | Verify the slip with no hub running | |

## The paid call

```
POST <hub>/offers/<offerHash>/call
content-type: application/json

{"input": <matches the offer's input schema>, "lineage": ["0x…"]}
```

`lineage` is optional. It lists the offer hashes of the purchases this call is nested inside, outermost first. The hub refuses the call, before payment, when this offer's hash is already in that list or when appending it would repeat any hash already there ([terms.md](terms.md) §2).

| Step | Request | Answer |
|---|---|---|
| Ask | no payment header | `402`. The body is x402 v2 `PaymentRequired`, also base64-encoded in the `PAYMENT-REQUIRED` header. |
| Pay | `PAYMENT-SIGNATURE: base64(PaymentPayload)` | `200 {output, slip}`, with `PAYMENT-RESPONSE: base64(SettleResult)` |
| Refused | | A JSON `{code, message}` with a stable `code`, such as `seller-offline` or `bad-payment`. Branch on `code`, not on the message. |

The hub refuses input that fails the schema before it asks for payment. It also refuses an offline seller before any payment, with "Nothing was charged."

`accepts` holds one entry per rail the offer takes and the hub runs. `extensions.bazaar` describes the request body, `{input, lineage?}`, and the output, using `@x402/extensions`.

## Options a generic x402 client can pay

### `exact` on Circle Gateway

The scheme is `exact`, with `extra.name: "GatewayWalletBatched"`, on `eip155:5042002`. A client that pays Gateway's batched scheme pays this as it would any Gateway seller. Gateway debits the buyer's Gateway balance at once and credits the seller in a later batch, so the settlement is a Gateway transfer id, not a chain transaction. The Circle CLI can pay this option ([spec/discovery.md](spec/discovery.md)).

### `exact` on Hedera

The scheme is `exact`, on `hedera:testnet`, for HTS USDC `0.0.429274`. The buyer signs one `TransferTransaction`:

- exactly one debit from the buyer and one credit to `payTo`, of `amount`;
- the memo `cs1:<offerHash>`;
- a transaction id that names `extra.feePayer` as the payer of fees.

The facilitator co-signs as fee payer and submits. The hub's rail checks the transfer before any facilitator sees it, and claims each transaction id once ([hedera.md](hedera.md)).

Check `extra.feePayer` against the facilitator's own `GET /supported` before signing. A fee payer that never settles holds the signed payment until it expires.

## The `countersign` option

The scheme is `countersign`. This is the escrow rail, and it is what makes a payment refundable. A client must implement it to pay it.

1. **Check the entry before signing.** The amount, payee, `extra.offerHash` and `extra.deadlineSeconds` must equal the offer you fetched from `GET <hub>/offers/<offerHash>`, and that offer must hash to `offerHash` (keccak256 of canonical JSON, [spec/offer.md](spec/offer.md)). The `extra.escrow`, `extra.chainId` and the asset must be an escrow you trust, not one the hub names. The buyer's pinned list is `packages/buyer/src/known-rails.ts`.
2. **Derive the job id.** Hash `Countersign(offerHash, buyer, payee, amount, deadline, salt)` under the escrow's EIP-712 domain `{Countersign, 1, chainId, escrow}` (`jobIdOf` in `packages/core/src/countersign.ts`).
3. **Sign the token's EIP-3009 `ReceiveWithAuthorization`.** Use `to = escrow`, `value = amount`, `nonce = jobId`, under the token's domain `{extra.tokenName, extra.tokenVersion, chainId, asset}`.
4. **Send the payload.** It is `CountersignPayload {terms, authorization, signature}` inside the x402 `PaymentPayload` ([spec/countersignature.md](spec/countersignature.md)).

`packages/core` exports each step: `jobIdOf`, `authorizationTypedData`, `countersignPayload` and `checkCountersign`. A TypeScript client can import them rather than re-derive them. A test vector shared with the Solidity tests proves the TypeScript and on-chain `jobId` agree.

Once funded, the job closes on chain through `release`, `refund` or `cancel`, and any party can read it with `jobOf(jobId)` ([spec/escrow.md](spec/escrow.md)).

## Discovery

| Route | Format | For |
|---|---|---|
| `GET /discovery/resources` | x402 Bazaar list, the same shape as Circle's discovery API (`{x402Version, items, pagination}`), with `query`, `category`, `type`, `limit` and `offset` | Bazaar readers, the Circle CLI |
| `GET /.well-known/agent-card.json` | A2A agent card, protocol 0.3.0 | A2A clients |
| `GET /.well-known/skills/index.json` | Skills index | Skill-aware agents |
| `GET /openapi.json` | OpenAPI 3.1, one explicit call path per offer | OpenAPI tooling |
| `GET /offers`, `/offers/:hash`, `/offers/search?q=` | countersign's own listing, with `online` and `status` | countersign buyers |
| `GET /rails` | Each rail's declaration: network, scheme, asset, kind, escrow, who pays gas | Anyone choosing a rail |

A `query` that contains an offer hash, such as a full call URL, finds that offer. This is what the Circle CLI's `inspect` relies on.

### Circle CLI

`@circle-fin/cli` 1.2.3 reads a hub as its catalogue:

```sh
export CIRCLE_DISCOVERY_URL=<hub>/discovery/resources
circle services search
circle services inspect <hub>/offers/<offerHash>/call
```

Neither command needs a Circle login. `bun scripts/circle/interop.ts --hub <hub>` is the scripted check. It runs the real CLI when `circle` is on `PATH`, and otherwise checks the CLI's contract in process. It reads only: nothing is signed or paid.

### Reading other catalogues

countersign's buyer reads any Bazaar list, Circle's public one included:

```sh
bun packages/buyer/src/cli.ts discover --catalogue circle "web search"
```

It marks an item as payable only if its rail is already pinned. A countersign hub's call URL from any catalogue can be bought directly, and the offer is still re-read from its hub and re-hashed.

## Receipts

A slip proves itself without the hub ([spec/slip.md](spec/slip.md)):

```sh
bun packages/verify/src/cli.ts slip.json [--rpc <url>]
```

The verifier is a standalone package that imports nothing from the hub. To verify in another language:

1. Hash the canonical JSON of `body` with keccak256 and compare it with `hash`.
2. Recover the EIP-712 `Release(jobId, slipHash)` signature to `body.seller`. The domain is the escrow's on escrow rails, and `{Countersign, 1}` otherwise.
3. Re-derive `jobId` from the countersigned terms in `payment`.
4. With an RPC URL, find a `Released(jobId, slipHash)` log from `body.escrow` in the settlement transaction.

Canonical JSON here is a strict subset of RFC 8785. It sorts keys by UTF-16 code unit, uses no whitespace, and refuses non-integer numbers ([decisions.md](decisions.md), D5).

## Identity

- **ERC-8004.** The hub shows a seller's registration on `GET /sellers` (`apps/hub/src/identity.ts`). It reads the Arc testnet IdentityRegistry only when `ERC8004_FROM_BLOCK` and `ARC_RPC_URL` are set; otherwise `erc8004` is `null`. A registration proves the seller registered a key, not that it is honest.
- **ENS.** An offer may name the seller's ENS name on Sepolia. A client that pays a named seller should resolve the name itself, with CCIP-Read off, and refuse unless the name resolves to `seller` and every EVM payee is that address. `checkEnsLock` in `packages/core/src/ens.ts` does exactly this ([spec/offer.md](spec/offer.md)).

## Not interoperable yet

- **Circle's public catalogue.** Every item in it is on a mainnet. A testnet hub is readable by the same code, but it is not listed there.
- **The `countersign` scheme in third-party clients.** No client outside this repository implements it. A generic x402 client sees the option and skips it.
- **MPP.** The MPP rail settles live on Tempo testnet through its demo endpoint, but it is not wired into the hub yet ([mpp.md](mpp.md)).
- **Escrow v2 terms.** The v2 design countersigns the offer's `bond` and `reviewWindow` inside `jobId` (D16; `COUNTERSIGN_V2_TYPES` in `packages/core/src/countersign.ts`). No v2 escrow is deployed yet (#98), so a client signs v1 terms today.
