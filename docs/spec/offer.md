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
| `issuedAt` | Unix seconds. |

`offerHash = keccak256(canonicalJson(offer))`. Canonical JSON sorts keys by UTF-16 code unit, uses no whitespace, and refuses non-integer numbers (`packages/core/src/canonical.ts`). Any change, the price included, makes a new offer with a new hash. A countersignature names one hash, which is how a moved price is caught.

A seller publishes by POSTing `{offer, sig}` to the hub, where `sig` is an EIP-191 signature by `seller` over the text `countersign offer <offerHash>`.
