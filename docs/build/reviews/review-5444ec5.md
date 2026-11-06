> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 5444ec5 (cs/wc) — wc-02: countersign scheme, escrow ops, whitechain rail, order refunds

Reviewer: cs-w1. Result: **new blockers=1 (B1b), still open from d1fcf2a: B1, B2; should-fix=2**. Tests in `packages/relay/test/w1-attacks.test.ts` on `cs/w1`: B1, B2 and B1b all fail on this sha (0 of 3 pass).

## Blocker
**B1b. `POST /orders/:id/refund` on the merchant server is unauthenticated.** Same defect as B1, on the new route. For a held escrow order it makes the merchant key sign `Cancel(jobId)` and forwards it to `/escrow/cancel`: anyone who knows an order id (public via `/orders`) cancels any held order, refunding the buyer before delivery and denying the merchant the sale; for a paid order it signs the EIP-3009 transfer back. The test expects 401/403 and no POST to `/escrow/cancel`; it gets 200 and the call. Fold into wc-05: one auth gate over every merchant POST route (`/refund/:id`, `/orders/:id/refund`), not per route.

## Still open from d1fcf2a
B1 (unauthenticated `/refund/:paymentId`) and B2 (pending refund reserves nothing) both still fail on this sha, as expected; they are in wc-05. B2 also applies to released escrow jobs now, since `findRefundable` routes them through the same `refundPayment`.

## Should-fix
1. **A released job refunds the full amount, but the merchant received `amount - toll`.** `ledger.refundable` returns `job.amount - refunded` for released jobs, so the one-click refund costs the merchant the toll out of pocket. Decide on purpose: either cap at `amount - toll` or say the merchant eats it.
2. **The relay sponsors fund() for any valid countersignature to any payee** (S1 from d1fcf2a, now also on the escrow path). The ceilings bound it; add the payee allowlist in wc-05.

## Attacked, held
- Guards: escrow calls go through `Relayer.allowed` (escrow allowlist) and the same simulate, fee cap, ceiling and balance floor as transfers. This answers the 3a36865 should-fix 2.
- `check()` pins `extra.escrow` to the allowed set, re-verifies through `escrowRail` (one-sided deadline, from d1d94e6), then simulates `fund` before spending; an already-ledgered job answers without touching the chain.
- Release, cancel and refund are on-chain gated (seller signature, deadline), so the relay endpoints add no authority; an early refund or a bad signature fails in simulation before gas is spent. Concurrent closes serialise in the queue; the second fails simulation.
- Cancel is signed with the Whitechain domain and the configured escrow only.
