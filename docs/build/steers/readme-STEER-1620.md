> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Steer for cs-readme, 16:20 IST: a new doc

Write `docs/terms.md`, the marketplace terms, under the same rules as the README:

- every sentence true of the code today;
- facts taken from `docs/spec/`, `docs/decisions.md` and the contracts, never invented;
- the same voice, and lowercase "countersign".

Branch `cs/readme`; pull request into `cs/int`; then post `READY integrate`.

## Contents

1. What listing an offer means:
   - the seller signs the offer;
   - the hub stores and serves it;
   - how an offer is delisted.
2. What the hub does and does not do:
   - no custody: funds move from buyer to escrow to seller on chain, or directly on the direct rails;
   - the hub never holds a key.
3. What the buyer's countersignature binds: the offer hash and the amount, inside the envelope's limits.
4. Delivery, release and refunds, exactly as the escrow contract has them: who can release, the refund and cancel paths, and any time windows.
5. Fees and the toll, exactly as the code computes them.
6. Testnet only and no warranty; what the escrow protects, and what it does not (post-delivery collusion).
7. A pointer to `docs/ens.md` for how seller names are shown. That doc comes later, once orch-cs's name-resolver code exists. Do not write it before then.

Link the terms from the README.

