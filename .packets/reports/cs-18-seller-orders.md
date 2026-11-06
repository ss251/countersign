# cs-18-seller-orders — report

## What shipped

The hub now serves seller-side reads in the shape cs-wc's `orders-contract.md` names:

- `GET /orders?seller=<0x address>&limit=<1..500, default 200>`
  - `{orders: Order[]}`, newest first (`created_at DESC, rowid DESC`).
  - Seller match is case-insensitive against the stored offer's `seller`.
  - Unknown seller is `{orders: []}`; a malformed address is 400 `bad-request` with "Refused. Name the seller."
- `GET /orders/:id`
  - The same `Order` plus `refunds`, passed through from the Whitechain relay for `whitechain` orders.
  - Unknown id is exactly 404 `{"code":"not_found"}`.
- `GET /jobs?seller=`
  - `/jobs` now requires exactly one of `buyer` or `seller`; both or neither is 400 `bad-request` with "Refused. Name the buyer or the seller."
  - Every job row now carries `buyer` and `seller`; seller rows use the same case-insensitive offer-seller join as `/orders`.

Each `Order` carries every field in the contract: `id`, `kind`, `rail`, `network`, `networkName`, `asset`, `explorer`, `customer`, `merchant`, `amount`, `fee`, `refunded`, `refundable`, `status`, `closeKind`, milliseconds for `createdAt`/`deadline`/`receivedAt`/`closedAt`, transactions, `refundTxs`, hashes, `description`, plus `settleTxUrl`/`closeTxUrl` and `relayUnavailable` when the relay cannot answer.

Mapping decisions follow the packet:

- `kind` is `escrow` only when the rail declaration says so, otherwise `exact`.
- `status`/`closeKind` follow the packet's table, including `refund_pending` for a failed escrow and `paid` for a failed direct rail.
- `fee` is the contract's floor for a released escrow when the rail exposes `escrow.tollBps`; otherwise `"0"`.
- `refunded` is the amount only for a refunded job; `refundable` is always `"0"`.
- `receivedAt` is `closedAt` for a released escrow, `createdAt` for a paid direct/batched order, otherwise null.
- `explorer` is the template base only when `explorerTx` is `<base>/tx/{tx}`; templated tx URLs are still built for `settleTxUrl`/`closeTxUrl`.
- `networkName` uses the fixed map plus the network string fallback.

Whitechain pass-through calls `${WC_RELAY_URL}/orders/:jobId` with `AbortSignal.timeout(3000)`, only for `whitechain` orders and only when `WC_RELAY_URL` is set. A 200 JSON object supplies `fee`, `refunded`, `refundable`, `refundTxs`, `status` and `closeKind`; `refunds` is used only by `/orders/:id`. Any failure keeps the hub values and adds `relayUnavailable: true`.

## Files changed (all inside the lease)

- `apps/hub/src/orders.ts` (new) — order mapping and both `/orders` routes.
- `apps/hub/src/store.ts` — new read method `listJobsBySeller`; no schema change.
- `apps/hub/src/buyerplumbing.ts` — `/jobs` handler only: buyer-or-seller selection and `buyer`/`seller` row fields.
- `apps/hub/src/app.ts` — registers the orders routes and adds optional `HubDeps.relayUrl`.
- `apps/hub/src/index.ts` — passes `relayUrl: process.env.WC_RELAY_URL`.
- `apps/hub/src/openapi.ts` — `/orders`, `/orders/{id}`, `/jobs` paths plus `Order`, `Refund` and `Job` schemas.
- `packages/rail/src/rail.ts` — optional `EscrowOps.tollBps()`.
- `packages/rail/src/escrow/index.ts` — reads the contract's `tollBps()` view once per rail instance and caches the promise.
- `apps/hub/test/orders.test.ts` (new) — mapping, ordering, address validation, limit, single-order, bare 404, and fake-relay Whitechain pass-through/offline cases.
- `apps/hub/test/buyerplumbing.test.ts` — appended seller `/jobs` coverage, both-parameters refusal, and buyer queries still pass.
- `.packets/reports/cs-18-seller-orders.md` — this report.

## Verification

From the worktree root:

```
bun install                                          # no changes
bun run typecheck                                    # pass
bun test apps/hub packages/rail                      # 168 pass, 0 fail
bun test                                             # 581 pass, 3 skip, 0 fail
forge test                                           # 29 pass, 0 skipped
```

The 3 skips are the pre-existing live-chain suite in `apps/web/test/onchain.live.test.ts`, gated on `CS_LIVE=1`; no test was skipped or added as skipped in this packet.

No browser of any kind was launched. No network beyond localhost fakes was used in tests. The hub never gained a refund route.

## Status

Committed in small `(refs #32)` commits. Not pushed, merged or deployed.
