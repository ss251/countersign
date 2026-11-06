# Offer

What a seller publishes. Type `Offer` in `packages/core/src/types.ts`; checks in `packages/core/src/offer.ts`.

| Field | Meaning |
|---|---|
| `v` | Always `1`. |
| `seller` | The seller's identity key. It signs every slip and is the payee on EVM rails unless `payTo` says otherwise. |
| `title`, `summary` | What a person reads. |
| `adapter` | `skill`, `mcp` or `openapi`: how the runner serves it. The runner serves `skill` and `mcp`; `openapi` is not built ([status.md](../status.md)). |
| `upstream` | For catalogue items, the upstream URL and licence. |
| `input`, `output` | JSON Schema 2020-12. A call whose input fails is refused before payment. An output that fails is a failed delivery. On an escrow rail it is never released, and the buyer gets the money back after the deadline. A direct rail (Hedera, Gateway) settles before the seller runs, so that payment is not returned. |
| `price` | Atomic units of a 6-decimal USD stablecoin, as a digit string. |
| `deadline` | Seconds the seller has to deliver once the escrow is funded, from 10 s to 7 days. |
| `bond` | Atomic amount the seller declares. Declared only: no deployed contract collects it. The bond code is in the contract on `main` ([#93](https://github.com/ss251/countersign/issues/93)); the deployed escrows are v1 and do not collect it, and the audit's fixes (D15) come first. |
| `rails` | Accepted rails, most preferred first. |
| `payTo` | Payee per rail where it is not `seller`, for example a Hedera account id. |
| `issuedAt` | Unix seconds. |

`offerHash = keccak256(canonicalJson(offer))`. Canonical JSON sorts keys by UTF-16 code unit, uses no whitespace, and refuses non-integer numbers (`packages/core/src/canonical.ts`). Any change, the price included, makes a new offer with a new hash. A countersignature names one hash, which is how a moved price is caught.

A seller publishes by POSTing `{offer, sig}` to the hub, where `sig` is an EIP-191 signature by `seller` over the text `countersign offer <offerHash>`.
