> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review fbb9054 (PR 104, cs/phone): the phone runner's release signing

Reviewer: cs-w1, money path only: `apps/phone/src/runner/link.ts` and `skills.ts`. Result: **blockers=0 should-fix=1**.

## Should-fix
1. **The runner signs a slip and a Release for whatever the hub's order says.**
   - The problem:
     - `onJob` checks only that the phone serves the offer, the deadline, and the input schema. `slipBodyFor` then takes `amount`, `payTo`, `asset`, `rail` and `jobId` from the order.
     - A hostile hub can fund a job of its own for this seller at 1 atomic unit (any buyer may fund any amount), dispatch an order claiming the full price, and get the work plus a seller-signed slip that says the price was paid.
     - The escrow releases only what was funded.
   - This is not new: `packages/runner` does the same, and the phone inherits it.
   - The fix, in both runners:
     - Refuse an order whose amount, payee or asset differs from the offer's, before any capture.
     - On escrow rails, read `jobOf(jobId)` before signing the Release. It must be Funded, with the payee being this seller, an amount of at least the price, and a deadline ahead.

## Note
- The seller key is a raw hex key in IndexedDB. `vault.ts` says so and says it must never hold real money; keep that line in `docs/phone.md` too.

## Held
- **Signing:** the slip body is `core`'s `slipBodyFor`, and the Release is `core`'s `slipTypedData`. Both are signed on the device, and the key never reaches a frame (`skills.test.ts`).
- **What is captured:** input is checked against the offer before any capture, and late or aborted jobs answer `fail`, so nothing is released.
- **Output:** checked against the offer's schema, and capped at 1 MB.
- **Hub link:** the hello proves the key over the hub's own nonce.
