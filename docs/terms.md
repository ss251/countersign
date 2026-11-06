# Marketplace terms

What happens when a seller lists an offer on a countersign hub and a buyer agent pays for a call. Each term below describes what the code and contracts in this repository do today. Where a term and the code disagree, the code is what runs.

## 1. Listing an offer

- **The seller signs the offer.** A seller publishes by POSTing `{offer, sig}` to `/offers`. `sig` is an EIP-191 signature by `offer.seller` over the text `countersign offer <offerHash>`. The hub recomputes `offerHash` and refuses the offer if the signature does not recover to `offer.seller` ([spec/offer.md](spec/offer.md)).
- **An offer is fixed by its hash.** `offerHash = keccak256(canonicalJson(offer))`. Any change, the price included, makes a new offer with a new hash. A countersignature names one hash ([spec/offer.md](spec/offer.md)).
- **The hub stores and serves it.** A published offer is stored and listed on `GET /offers` and `GET /offers/:offerHash`, with `online` (whether the seller's runner is connected now) and `status` (`listed` or `delisted`).
- **Taking an offer out of service.** There is no delist route today, so no offer is marked `delisted`. A seller stops serving an offer by stopping its runner. The listing then shows `online: false`, and a call answers "The seller is offline. Nothing was charged." before any payment is asked for. A changed offer is a new listing, and the earlier hash stays listed.

## 2. What the hub does and does not do

- **Custody.** The hub never holds the buyer's money.
  - On the escrow rails (Arc, Whitechain) funds move from the buyer to `CountersignedEscrow`, and from the escrow to the seller or back to the buyer, on chain ([spec/escrow.md](spec/escrow.md)).
  - On the Hedera rail the buyer's signed transfer goes directly to the seller's account, submitted by a hosted x402 facilitator ([hedera.md](hedera.md)).
  - On the held Hedera rail (`hedera-scheduled`) the money stays in the buyer's own account, inside a schedule that runs only when both the seller and the hub have signed it. The hub co-signs only after checking the delivery, so neither can release it alone. Every transfer out of the seller's payee account, earnings included, needs the hub's co-signature too; tonight that co-sign is done by hand ([hedera.md](hedera.md) "Scheduled checkout").
  - On the `eip3009` rail the buyer's signed `TransferWithAuthorization` moves USDC on Arc directly to the seller, and the hub's relayer submits it.
  - On the Gateway rail the buyer's deposit sits in Circle Gateway. Gateway debits the buyer at once and credits the seller in a later batch.
- **Keys.** A person who signs in with `countersign login` has no key on their machine, as a buyer or as a seller. Their wallet is a Privy server wallet that the countersign app controls: the hub holds the app's Privy credentials and signs for the wallet only during a signed-in session. It signs only a payment from that wallet into an escrow the hub runs, capped at 1 USDC on Arc or 1 USDT on Whitechain per signature and not as a running total; a release slip; or a runner's sign-in, offer, delist or canary message. The CLI or MCP server checks the envelope's other limits before it asks the hub to sign. Selling under a login has not yet run on production. On the Arc escrow rail the hub holds one relayer key (`CS_RELAYER_KEY`). It submits the buyer's `fund` and the seller's `release` and pays their gas. It cannot change what they signed: the escrow checks the buyer's countersignature on `fund` and the seller's signature on `release`. On the Whitechain rail the hub holds no key: it passes `fund`, `release`, `refund` and `cancel` to the relay (`WC_RELAY_URL`), which submits them and pays the gas. On the direct Hedera rail the hub holds no Hedera key. On the held Hedera rail it holds one release key: it co-signs a schedule only after a checked delivery, and it co-signs any transfer out of the seller's payee account. It cannot move the buyer's money without the seller's signature.
- **Gates.** The hub refuses a call whose input fails the offer's input schema before payment. It checks the seller's output against the output schema and the signed slip before release. An output that fails is a failed delivery. On an escrow rail it is never released, and on the held Hedera rail the hub never co-signs it, so the schedule cannot run; on a direct rail the payment has already settled (§4) ([spec/offer.md](spec/offer.md)).
- **Purchase cycles.** A call may carry `lineage`: the purchases it is already inside, outermost first, each named by its offer hash or its job id. Before any rail runs and before any 402, the hub answers 422 `purchase-cycle` when this offer's hash is already in that list, or when the list already names one hash twice. It answers 409 `lineage-cycle` when an ancestor job it recorded bought this offer or an offer from the same seller, or when an entry names this offer's seller. Nothing is charged in either case. A lineage of distinct entries that names neither this offer nor its seller is allowed.

## 3. What the buyer's countersignature binds

The buyer signs one message. On the escrow rails it is the token's EIP-3009 `ReceiveWithAuthorization`, with `to` the escrow, `value` the amount and `nonce` the `jobId`. The `jobId` is the EIP-712 hash of the offer hash, buyer, payee, amount, deadline and salt under the escrow's domain, so the signature binds all of them, plus the chain and the escrow ([spec/countersignature.md](spec/countersignature.md)). On the Hedera rail the signed transfer binds the amount and payee, and its memo `cs1:<offerHash>` binds the offer ([hedera.md](hedera.md)).

The buyer's agent signs only inside its envelope: not revoked, not expired, on the allowlist, within the budget cap and the per-merchant limit, and held for the human above `askAbove` ([spec/envelope.md](spec/envelope.md)). Before signing it compares the hub's 402 with the offer it fetched and with a pinned table of known rails, and refuses a hub that names another escrow or payee.

## 4. Delivery, release and refunds

As the escrows production uses have them: v2 on both chains, for unbonded jobs only ([spec/escrow.md](spec/escrow.md)). The bond and review changes described there as Escrow v2 are deployed on Arc at [`0x10A3…F3CE`](https://explorer.testnet.arc.io/address/0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE) and on Whitechain Sepolia at [`0x55b3…0391`](https://explorer.testnet.whitechain.io/address/0x55b3d98C17Ba0878DC93fB1521c76c9a10778391), and production's Whitechain rail now runs on the Whitechain one for unbonded jobs. Each job closes once: release, refund and cancel each require the job to be `Funded`.

| Action | Who | When | Money goes to |
|---|---|---|---|
| `fund` | anyone may submit the buyer's countersignature | before the countersigned deadline | the escrow, the full amount |
| `release` | anyone may submit, with the payee's EIP-712 `Release(jobId, slipHash)` signature (ECDSA or ERC-1271) | until the deadline, inclusive | the payee, `amount - toll`; the treasury, `toll` |
| `refund` | anyone | only after the deadline | the buyer, the full amount |
| `cancel` | the payee, or anyone with the payee's `Cancel(jobId)` signature | any time the job is `Funded` | the buyer, the full amount |

- **Deadline.** An offer gives the seller 10 seconds to 7 days to deliver ([spec/offer.md](spec/offer.md)). The hub's escrow rail accepts a countersigned deadline no shorter than the offer promises, with 15 seconds of clock skew, and no more than 300 seconds longer.
- **Failed delivery, by rail.** The escrow rails and the held Hedera rail keep the buyer's money from the seller when a delivery fails. On every other rail the payment has settled before the call is delivered.

  | Rail | Where the money is during the call | If the delivery fails |
  |---|---|---|
  | Escrow: `escrow` (Arc), `whitechain` | In `CountersignedEscrow` | It returns to the buyer in full by `refund` after the deadline. The hub sweeps those refunds every 30 seconds, and anyone else may call `refund` too. |
  | Held Hedera: `hedera-scheduled` | In the buyer's own account, inside a schedule | The hub does not co-sign, so the schedule cannot execute and expires with nothing moved: [`0.0.11343208`](https://testnet.mirrornode.hedera.com/api/v1/schedules/0.0.11343208) was signed by the seller but not the hub, and never executed. |
  | Direct: `hedera`, `eip3009`, `gateway`, `mpp` (none of them live on the production hub; `gateway` and `hedera` are listed, because older offers name them) | With the seller already (`gateway`: debited from the buyer's Gateway balance at once, credited to the seller in a later batch) | It is not returned. No code in this repository returns a payment on these rails, and the slip records the failure. |

  A rail is live when the hub declares it on its `/rails`, and listed when offers or discovery name it but the hub does not settle it. The production hub's live rails are on [`/rails`](https://hub-production-e85e.up.railway.app/rails) and in [status.md](status.md).

## 5. Fees and the toll

- On the escrow rails, `toll = amount * tollBps / 10_000`, rounded down. `tollBps` is fixed at deployment, at most 1,000, and 100 (1%) on the deployed escrows. The payee receives `amount - toll`. Refunds and cancels return the full amount, with no toll.
- The toll goes to a `FeeSplit` treasury, which pays its whole balance to fixed payees by fixed shares when anyone calls `distribute(token)`. Payees and shares are set at deployment and cannot change.
- countersign's code charges no toll on the Hedera and Gateway rails. On Hedera the facilitator pays the network fee.
- Gas for `fund` and `release` is paid by the submitter, not the buyer: the hub's relayer on Arc, the relayer on Whitechain.

## 6. Testnet only, no warranty

- Every rail in this repository is configured for a testnet: Arc testnet (chain 5042002) for the escrow and Gateway rails, Whitechain Sepolia (chain 1874) and Hedera testnet. The mainnet profile is pending, and a hub refuses to boot on mainnet until it is complete ([mainnet.md](mainnet.md)).
- The software is provided under the MIT licence, as is, without warranty of any kind ([LICENSE](../LICENSE)).
- **What the escrow protects against:** a moved price, a swapped payee or offer, an extended deadline, replay of one countersignature, and a seller who never delivers, which the buyer recovers by refund after the deadline.
- **What it does not protect against.** Release needs only the payee's signature, so the escrow pays a funded job whenever the payee signs a release before the deadline. It cannot judge the output. The hub's output check is the delivery gate, and it runs off chain.
- **Post-delivery collusion.** Once released, nothing on chain reverses a payment. A seller, alone or together with the hub, can release against output the buyer did not get or cannot use. The slip's `outputHash` is the buyer's evidence of what it was given, not a remedy.
- **The bond is declared, not collected.** No contract production uses holds it ([spec/offer.md](spec/offer.md)). Production uses v2 on both chains, for unbonded jobs only, so no bond is collected yet. Escrow v2, which collects the bond, is deployed on Arc at [`0x10A3…F3CE`](https://explorer.testnet.arc.io/address/0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE) and on Whitechain Sepolia at [`0x55b3…0391`](https://explorer.testnet.whitechain.io/address/0x55b3d98C17Ba0878DC93fB1521c76c9a10778391), and production's Whitechain rail now runs on it for unbonded jobs.
- **Token blocklists.** If the token blocklists the treasury, every release reverts until the deadline and buyers recover by refund. If it blocklists a buyer, refund and cancel to that buyer revert ([spec/escrow.md](spec/escrow.md)).

## 7. Seller names

- **By default, an offer names the seller only by its address.**
- **An offer may also carry the seller's ENS name on Sepolia** (`runner --ens`). The hub lists it, and the buyer pays it, only while two things hold:
  - the name resolves to the seller;
  - every EVM payee in the offer is that same address.
- **A Hedera payee is outside the name.**
- **Lookups never follow CCIP-Read,** and any failure is a refusal ([spec/offer.md](spec/offer.md)).
