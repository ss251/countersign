# Marketplace terms

What happens when a seller lists an offer on a countersign hub and a buyer agent pays for a call. Each term below describes what the code and contracts in this repository do today. Where a term and the code disagree, the code is what runs.

## 1. Listing an offer

- **The seller signs the offer.** A seller publishes by POSTing `{offer, sig}` to `/offers`. `sig` is an EIP-191 signature by `offer.seller` over the text `countersign offer <offerHash>`. The hub recomputes `offerHash` and refuses the offer if the signature does not recover to `offer.seller` ([spec/offer.md](spec/offer.md)).
- **An offer is fixed by its hash.** `offerHash = keccak256(canonicalJson(offer))`. Any change, the price included, makes a new offer with a new hash. A countersignature names one hash ([spec/offer.md](spec/offer.md)).
- **The hub stores and serves it.** A published offer is stored and listed on `GET /offers` and `GET /offers/:offerHash`, with `online` (whether the seller's runner is connected now) and `status` (`listed` or `delisted`).
- **Taking an offer out of service.** The hub has no route that delists an offer, so no offer is marked `delisted` today. A seller stops serving an offer by stopping its runner. The listing then shows `online: false`, and a call answers "The seller is offline. Nothing was charged." before any payment is asked for. A changed offer is a new listing, and the earlier hash stays listed.

## 2. What the hub does and does not do

- **Custody.** The hub never holds the buyer's money.
  - On the escrow rails (Arc, Whitechain) funds move from the buyer to `CountersignedEscrow`, and from the escrow to the seller or back to the buyer, on chain ([spec/escrow.md](spec/escrow.md)).
  - On the Hedera rail the buyer's signed transfer goes directly to the seller's account, submitted by a hosted x402 facilitator ([hedera.md](hedera.md)).
  - On the Gateway rail the buyer's deposit sits in Circle Gateway. Gateway debits the buyer at once and credits the seller in a later batch.
- **Keys.** The hub holds no buyer key and no seller key. The seller's key stays with its runner, and the buyer's with its agent. On the Arc escrow rail the hub holds one relayer key (`CS_RELAYER_KEY`). It submits the buyer's `fund` and the seller's `release` and pays their gas. It cannot change what they signed: the escrow checks the buyer's countersignature on `fund` and the seller's signature on `release`. On the Hedera rail the hub holds no Hedera key.
- **Gates.** The hub refuses a call whose input fails the offer's input schema before payment. It checks the seller's output against the output schema and the signed slip before release. An output that fails is a failed delivery and is never released ([spec/offer.md](spec/offer.md)).

## 3. What the buyer's countersignature binds

The buyer signs one message. On the escrow rails it is the token's EIP-3009 `ReceiveWithAuthorization`, with `to` the escrow, `value` the amount and `nonce` the `jobId`. The `jobId` is the EIP-712 hash of the offer hash, buyer, payee, amount, deadline and salt under the escrow's domain, so the signature binds all of them, plus the chain and the escrow ([spec/countersignature.md](spec/countersignature.md)). On the Hedera rail the signed transfer binds the amount and payee, and its memo `cs1:<offerHash>` binds the offer ([hedera.md](hedera.md)).

The buyer's agent signs only inside its envelope: not revoked, not expired, on the allowlist, within the budget cap and the per-merchant limit, and held for the human above `askAbove` ([spec/envelope.md](spec/envelope.md)). Before signing it compares the hub's 402 with the offer it fetched and with a pinned table of known rails, and refuses a hub that names another escrow or payee.

## 4. Delivery, release and refunds

As `contracts/src/CountersignedEscrow.sol` has them. Each job closes once: release, refund and cancel each require the job to be `Funded`.

| Action | Who | When | Money goes to |
|---|---|---|---|
| `fund` | anyone may submit the buyer's countersignature | before the countersigned deadline | the escrow, the full amount |
| `release` | anyone may submit, with the payee's EIP-712 `Release(jobId, slipHash)` signature (ECDSA or ERC-1271) | until the deadline, inclusive | the payee, `amount - toll`; the treasury, `toll` |
| `refund` | anyone | only after the deadline | the buyer, the full amount |
| `cancel` | the payee, or anyone with the payee's `Cancel(jobId)` signature | any time the job is `Funded` | the buyer, the full amount |

- **Deadline.** An offer gives the seller 10 seconds to 7 days to deliver ([spec/offer.md](spec/offer.md)). The hub's escrow rail accepts a countersigned deadline no shorter than the offer promises, with 15 seconds of clock skew, and no more than 300 seconds longer.
- **Failed delivery.** On an escrow rail the money stays in escrow and returns to the buyer by `refund` after the deadline. The hub sweeps those refunds itself every 30 seconds, and anyone else may call `refund` too.
- **Direct rails.** On the Hedera and Gateway rails the payment settles before the call is delivered, and there is no escrow. No code in this repository returns a payment on those rails when delivery fails.

## 5. Fees and the toll

- On the escrow rails, `toll = amount * tollBps / 10_000`, rounded down. `tollBps` is fixed at deployment, at most 1,000, and 100 (1%) on the deployed escrows. The payee receives `amount - toll`. Refunds and cancels return the full amount, with no toll.
- The toll goes to a `FeeSplit` treasury, which pays its whole balance to fixed payees by fixed shares when anyone calls `distribute(token)`. Payees and shares are set at deployment and cannot change.
- countersign's code charges no toll on the Hedera and Gateway rails. On Hedera the facilitator pays the network fee.
- Gas for `fund` and `release` is paid by the submitter, not the buyer: the hub's relayer on Arc, the relayer on Whitechain.

## 6. Testnet only, no warranty

- Every rail in this repository is configured for a testnet: Arc testnet (chain 5042002) for the escrow and Gateway rails, Whitechain Sepolia (chain 1874) and Hedera testnet. There is no mainnet configuration.
- The software is provided under the MIT licence, as is, without warranty of any kind ([LICENSE](../LICENSE)).
- **What the escrow protects against:** a moved price, a swapped payee or offer, an extended deadline, replay of one countersignature, and a seller who never delivers, which the buyer recovers by refund after the deadline.
- **What it does not protect against.** Release needs only the payee's signature, so the escrow pays a funded job whenever the payee signs a release before the deadline. It cannot judge the output. The hub's output check is the delivery gate, and it runs off chain.
- **Post-delivery collusion.** Once released, nothing on chain reverses a payment. A seller, alone or together with the hub, can release against output the buyer did not get or cannot use. The slip's `outputHash` is the buyer's evidence of what it was given, not a remedy.
- **The bond is declared, not held.** No contract collects it ([spec/offer.md](spec/offer.md)).
- **Token blocklists.** If the token blocklists the treasury, every release reverts until the deadline and buyers recover by refund. If it blocklists a buyer, refund and cancel to that buyer revert ([spec/escrow.md](spec/escrow.md)).

## 7. Seller names

Offers name the seller by its address. How seller names are shown will be described in `docs/ens.md`, once the name-resolver code exists.
