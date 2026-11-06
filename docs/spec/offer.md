# Offer

What a seller publishes. Type `Offer` in `packages/core/src/types.ts`; checks in `packages/core/src/offer.ts`.

| Field | Meaning |
|---|---|
| `v` | Always `1`. |
| `seller` | The seller's identity key. It signs every slip and is the payee on EVM rails unless `payTo` says otherwise. |
| `title`, `summary` | What a person reads. |
| `adapter` | `skill`, `mcp` or `openapi`: how the runner serves it. |
| `upstream` | For catalogue items, the upstream URL and licence. |
| `input`, `output` | JSON Schema 2020-12. A call whose input fails is refused before payment. An output that fails is a failed delivery and is never released. |
| `price` | Atomic units of a 6-decimal USD stablecoin, as a digit string. |
| `deadline` | Seconds the seller has to deliver once the escrow is funded, from 10 s to 7 days. |
| `bond` | Atomic amount the seller puts up. It is collected and locked when the escrow supports it: returned to the seller on release, refund or cancel, and paid to the buyer when the hub's gate fails the delivery. |
| `rails` | Accepted rails, most preferred first. |
| `payTo` | Payee per rail where it is not `seller`, for example a Hedera account id. |
| `ens` | Optional. The seller's ENS name on Sepolia, in ENSIP-15 normal form. See [ENS seller names](#ens-seller-names-and-the-payee-lock). |
| `issuedAt` | Unix seconds. |

`offerHash = keccak256(canonicalJson(offer))`. Canonical JSON sorts keys by UTF-16 code unit, uses no whitespace, and refuses non-integer numbers (`packages/core/src/canonical.ts`). Any change, the price included, makes a new offer with a new hash. A countersignature names one hash, which is how a moved price is caught.

A seller publishes by POSTing `{offer, sig}` to the hub, where `sig` is an EIP-191 signature by `seller` over the text `countersign offer <offerHash>`.

## ENS seller names and the payee lock

An offer may carry `ens`, the seller's ENS name on Sepolia. Because the offer is signed by `seller`, the name is the seller's claim. It becomes a fact only once it resolves. Checks live in `packages/core/src/ens.ts`.

The lock holds when both of these are true:

1. the name's ETH address, forward-resolved on Sepolia through the Universal Resolver, is `seller`;
2. every `payTo` entry that is an EVM address equals that same address. Payees that are not EVM addresses, such as a Hedera account id, are outside the lock.

So a buyer that resolves the name itself pays the name's address and nobody else.

| Who | When | What a failure does |
|---|---|---|
| Hub | `POST /offers` | Not listed: `422 ens-mismatch`, `422 ens-unresolved`, or `503 ens-unavailable` when the lookup fails or the hub has no resolver. |
| Buyer | `buy`, before asking for payment terms | Refused, nothing signed. The journal records `refused` with the same code. |
| Hub | `GET /sellers` | `name` is the ENS name from the seller's newest named offer, and only while the lock holds. Otherwise `null`. |

Every check fails closed: a lookup that errors is a refusal, never a pass. The buyer does not take the hub's word for the name. It resolves the name again at buy time, so a name re-pointed after listing is caught. Answers are cached for 60 seconds.

The seller sets the name with `runner publish|serve --ens alice.eth`. The hub reads `HUB_ENS_RPC_URL` and the buyer CLI reads `CS_ENS_RPC_URL`; both default to viem's public Sepolia endpoint. The Hedera buyer agent (`packages/buyer/src/hedera`) does not read `ens` yet.
