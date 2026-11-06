# cs-23-review-wiring: hub and rail serve escrow v2 (refs #98)

## What changed

### Rail

- `packages/rail/src/rail.ts`
  - `EscrowOps` gains optional `accept`, `dispute`, `releaseAfterWindow`, `reviewOf`, `sweepToll`, and
    `disputeWindowSeconds` (0 on v1, 600 on v2).
  - `status()` now reports `delivered` and `disputed`.
- `packages/rail/src/escrow/index.ts`
  - `version?: 1 | 2` (default 1). Only v2 adds the review methods.
  - v2 challenges quote `bond`, `reviewWindow` and `escrowVersion: 2`.
  - v2 verify/settle require v2 terms with the offer's exact bond and window and refuse with
    "Refused. The countersigned bond or review window is not the offer's." before any transaction.
  - v2 settle calls `fund(offerHash, cs)` with the v2 countersignature. v1 keeps `fundBonded`/`fund`
    exactly as today.
  - `reviewOf` converts the contract's `uint64` tuple to seconds.
- `packages/rail/src/escrow/abi-v2.ts` (new)
  - Hand-written v2 fragment, including `fund` with `Countersignature` in the contract's field order.
    Header notes it is replaced by the generated ABI when the contract lands.
- `apps/hub/src/rails.ts`
  - `ARC_ESCROW_VERSION` selects the Arc escrow rail's version, default 1.

### Hub

- `store.ts`: additive, guarded `review_window`, `delivered_at`, `ends_at`, `review_outcome`,
  `review_tx` columns; `delivered`/`disputed` job statuses; review fields in inserts, patches, row
  mapping and the seller-job query. Delivered jobs read as open to ratings and disputed as refunded,
  so the existing ratings switch stays exhaustive without cross-lane changes.
- `call.ts`: a successful release on a windowed v2 job reads `reviewOf`, stores the job as
  `delivered`, and puts `settlement.review = {window, deliveredAt, endsAt}` on the slip outside the
  hash. Every other path is unchanged.
- `bond.ts`: on v2, `failOnGate` calls `failDelivery` only while `now <= deadline + disputeWindowSeconds`.
- `review.ts` (new): `POST /jobs/:jobId/accept` and `/dispute`, registered in `app.ts`. No hub token;
  the buyer's typed signature is checked before the rail call. 404/409/401/502 as specified.
- `janitor.ts`: releases delivered jobs strictly after `ends_at` with outcome `window-elapsed`, and
  refunds only once the per-rail settle window has passed.
- `orders.ts` / `buyerplumbing.ts`: `/orders` and `/jobs` serve `reviewWindow`, `deliveredAt` (ms),
  `reviewEndsAt` (ms) and `reviewOutcome` from the store. `/orders` maps `delivered` to `in_review`
  and `disputed` to a dispute refund.

## Lease exception

One line outside the stated lease was required to keep `bun run typecheck` green:
`packages/relay/src/escrow-ops.ts` widens `JobView["chain"]` to include `delivered` and `disputed`.
It is a type-only change; no relay behaviour changes.

## Tests added

- `packages/rail/test/escrow-v2.test.ts` (7 tests): v2 402 extras, v2 `fund` encoding against a
  reference ABI, accept/dispute/releaseAfterWindow/sweepToll encoding, status 5/6, v1-terms refusal,
  moved bond/window refusal with no transaction, and v1 keeping no v2 methods and still using `fund`.
- `apps/hub/test/review.test.ts` (15 tests): accept, delivered and funded disputes, closed-window and
  past-deadline refusals, wrong signer with no transaction, unknown job, v1 job, failed rail
  transaction unchanged, call-path delivery review/slip, janitor boundaries for v2 and v1, the gate
  cutoff, and `/jobs` + `/orders` review fields.

No existing test expectation changed.

## Verification

From the worktree root:

```
bun install
bun run typecheck
bun test packages/rail apps/hub   # 317 pass
bun test                          # 932 pass, 3 skipped
forge test                        # 47 pass
```

No browser, no network, no deployment, no `contracts/**` change.
