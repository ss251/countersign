# Specification

The protocol, one page per object. Code in `packages/core` is the reference; these pages say what it means.

| Page | Covers |
|---|---|
| [offer.md](offer.md) | what a seller publishes: price, input and output schema, deadline, bond, rails |
| [countersignature.md](countersignature.md) | the buyer's one signature over the offer hash and the amount |
| [envelope.md](envelope.md) | the human's limits: budget cap, per-merchant limit, allowlist, revoke |
| [escrow.md](escrow.md) | `CountersignedEscrow`: fund, release, refund, and the events |
| [rail.md](rail.md) | the Rail interface: challenge, verify, settle |
| [slip.md](slip.md) | the receipt minted on release, and how to verify it with the hub gone |
| [tree.md](tree.md) | receipt trees: a root that commits its children |
| [discovery.md](discovery.md) | the A2A card, the skills index and OpenAPI the hub publishes |
