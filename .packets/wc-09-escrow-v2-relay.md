# wc-09: the Whitechain relay and rail speak escrow v2 (bond, review window, dispute)

**Design: decided.** cs-wc wrote this on Opus from `docs/spec/escrow.md` ("Escrow v2"), D11 and D12, and orch-cs's answers of 12:23:36Z. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

## Starts only when all three hold

1. Rajdeep's #98 PR is merged into `cs/int`, carrying:
   - the v2 contract;
   - the v2 `escrowAbi` in `packages/rail`;
   - the `EscrowOps` methods `release` (returning `delivered` and `reviewEndsAt`), `accept`, `dispute`, `releaseAfterWindow`, `failDelivery` and `reviewOf`.
2. cs-wc has deployed v2 on 1874 and written its address as `escrowV2` in `contracts/deployments/whitechain-sepolia.json`.
3. wc-08 is merged. It touches the same ledger, server and merchant-server files.

## Decisions

### 1. Two escrows, one ledger

- **Allowed escrows:** v1 `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4` and v2 (`escrowV2` from the deployments file, overridable with env `WC_ESCROW_V2`).
- **Where new jobs fund:** every new job funds on v2. Old jobs close on the escrow they were funded on.
- **Per-job escrow:** the `jobs` table gets a nullable `escrow TEXT` column. Existing rows read as v1. Every operation uses the job's own escrow.
- **v2-only calls on v1 jobs:** `accept`, `dispute`, `releaseAfterWindow` and `failDelivery` answer `{ ok: false, reason: "not_supported_on_v1" }` (409).

### 2. Hub authentication, for the two arbiter-only calls

- **The token:** env `RELAY_HUB_TOKEN`, sent as `Authorization: Bearer <token>`. Compare it in constant time (`timingSafeEqual` on equal-length buffers). Never log it, echo it or put it in argv.
- **When it is required:**
  - `fundBonded`, which happens through `/settle` when the requirements carry a non-zero bond or window;
  - `/escrow/fail` (`failDelivery`).
- **Refusals:**
  - with no `RELAY_HUB_TOKEN` set: 503 `{ ok: false, reason: "hub_auth_disabled" }`;
  - with the header missing or wrong: 401 `{ ok: false, reason: "hub_auth_required" }`.
- **Open to anyone:** `accept`, `dispute` and `releaseAfterWindow`, because the buyer's signature or the clock authorises them. The relay pays the WBT, inside the existing hourly ceiling.

### 3. New relayer call kinds

Next to `escrowFund`, `escrowRelease`, `escrowCancel` and `escrowRefund` in `relayer.ts`:

| Kind | Contract call | Arguments |
|---|---|---|
| `escrowFundBonded` | `fundBonded` | `offerHash`, `cs`, `bond`, `reviewWindow` |
| `escrowAccept` | `accept` | `jobId`, `buyerSig` |
| `escrowDispute` | `dispute` | `jobId`, `buyerSig` |
| `escrowReleaseAfterWindow` | `releaseAfterWindow` | `jobId` |
| `escrowFailDelivery` | `failDelivery` | `jobId` |

- Each one is encoded with the v2 `escrowAbi`.
- Each one passes the same guards as today: simulate first, the escrow allowlist (now v1 plus v2), the fee cap, the hourly ceiling and the balance floor.

### 4. Funding (countersign `settle`)

- **What to read:** `paymentRequirements.extra.bond` is an atomic string, `"0"` when absent. `extra.reviewWindow` is integer seconds from 0 to 86400, `0` when absent. Anything else is `invalid_payload`.
- **Bond or window non-zero:** require hub auth (section 2), then fund on v2 with `escrowFundBonded`.
- **Both zero:** fund on v2 with `escrowFund`, exactly as today.
- **What to record:** `escrow`, `bond` (TEXT) and `review_window` (INTEGER seconds) on the job row.

### 5. Release

- The input of `/escrow/release` is unchanged.
- **After the transaction confirms,** read its receipt logs:
  - **A `Delivered` event for this jobId:** the job becomes `delivered`, with `delivered_at` = `deliveredAt × 1000` and `review_ends_at` = `reviewEndsAt × 1000`. The answer is `{ ok, transaction, url, status: "delivered", reviewEndsAt: <unix seconds> }`. `reviewEndsAt` is in seconds, matching the event and the hub's `/jobs`.
  - **Otherwise** it is released, as today.

### 6. New routes (POST, JSON), answering like the existing escrow routes

| Route | Body | Pre-check against the ledger | Becomes |
|---|---|---|---|
| `/escrow/accept` | `{ jobId, buyerSig }` | v2 and `delivered`, else `job_not_in_review` | `released`, `accepted_at`, `accept_tx` |
| `/escrow/dispute` | `{ jobId, buyerSig }` | v2 and `funded` or `delivered`, else `job_not_open` | `disputed`, `disputed_at`, `dispute_tx` |
| `/escrow/release-after-window` | `{ jobId }` | v2, `delivered`, and now ≥ `review_ends_at`; else `job_not_in_review`, or `review_open` with `endsAt` (s) | `released`, `released_after_window = 1` |
| `/escrow/fail` | `{ jobId }`, plus hub auth | v2 and `funded`, else `job_not_open` | `failed`, `bond_slashed` = the job's bond |

**Custom errors from the simulation** map to reasons:

| Error | Reason |
|---|---|
| `NotBuyer` | `not_buyer` |
| `NotDelivered` | `not_delivered` |
| `ReviewOpen` | `review_open` |
| `ReviewClosed` | `review_closed` |
| `NotOpen` | `not_open` |
| `NotArbiter` | `not_arbiter` |
| `BondMissing` | `bond_missing` |

**`GET /escrow/jobs/:jobId`** adds `escrow`, `bond`, `reviewWindow` (s), `deliveredAt` (s) and `reviewEndsAt` (s), each `null` when unknown.

### 7. The ledger and the order view

**New nullable `jobs` columns,** each added with `ALTER TABLE` only when missing: `escrow`, `bond`, `review_window`, `delivered_at`, `review_ends_at`, `accepted_at`, `accept_tx`, `disputed_at`, `dispute_tx`, `released_after_window` (INTEGER 0/1) and `bond_slashed` (TEXT).

**`JobStatus`** adds `delivered`, `disputed` and `failed`.

**`closeKindOf`:**

| Job status | Close kind |
|---|---|
| `released` | `release` |
| `cancelled` | `cancel` |
| `refunded` | `deadline_refund` |
| `disputed` | `dispute_refund` |
| `failed` | `delivery_failed` |

**The order status in `jobOrder`:**

| Job status | Order status |
|---|---|
| `pending` | `pending` |
| `funded` | `held` |
| `delivered` | `in_review` |
| `released` | as today, through `transferStatus` |
| `cancelled` | `cancelled` |
| `refunded`, `disputed`, `failed` | `refunded` |

**`refundable`:** `held` and `in_review` keep the full amount, because the payee may still cancel. `disputed` and `failed` are `"0"`.

**Order fields** (in `/orders` and `/orders/:id`, milliseconds unless marked), as in cs-wc's contract that orch-cs adopted:
- `deliveredAt`, `reviewEndsAt`, `reviewWindow` (s);
- `acceptedAt`, `acceptTx`, `disputedAt`, `disputeTx`;
- `releasedAfterWindow` (boolean);
- `bondSlashed` (atomic, `"0"` when none);
- `slipHash` and `closedAt`, if wc-08 has not already added them.

### 8. Reconcile

`reconcileOrder` reads `jobOf(jobId)` on the job's escrow. For v2 it also reads `reviewOf(jobId)` and `bondOfJob(jobId)`, and moves the ledger to the chain's state when they differ:

| Chain status | Ledger becomes |
|---|---|
| 5, Delivered | `delivered`, with the review times |
| 2, Released | `released` |
| 6, Disputed | `disputed` |
| 4, Failed | `failed`, with `bond_slashed` |
| 3, Refunded | as today |

This covers anyone who calls the contract directly. Times it cannot know stay `null`.

### 9. The Whitechain rail (`packages/rail/src/whitechain/index.ts`)

- **Options** gain `hubToken?: string`. When set, it is sent as the Bearer header on `/settle` and `/escrow/fail` only.
- **The hub** passes env `WC_RELAY_TOKEN`. This change is in the hub's rail wiring, `apps/hub/src/rails.ts`, the single line that builds `whitechainRail`.
- **Methods:** `release` returns `{ …SettleResult, delivered, reviewEndsAt }` from the relay's answer. `accept`, `dispute`, `releaseAfterWindow` and `failDelivery` POST to the routes in section 6. `reviewOf` reads `GET /escrow/jobs/:jobId`.
- **Signatures:** these follow the merged `EscrowOps` exactly.

### 10. The merchant service

`POST /orders/:id/refund` on an escrow order in `in_review` cancels, exactly as for `held`: `signCancel`, then `/escrow/cancel`.

## Lease

- `packages/relay/src/{server,escrow-ops,countersign-scheme,relayer,ledger,reconcile,config,merchant-server}.ts` and `packages/relay/test/**`;
- `packages/rail/src/whitechain/index.ts` and its test;
- the one `whitechainRail(...)` line in `apps/hub/src/rails.ts`.

Read only: the contract, its ABI and `contracts/deployments/whitechain-sepolia.json`. No view code: `apps/web` is cs-wc's, on Opus. Never commit `bun.lock`.

## Tests (no network; fake chain and relayer, as the existing relay tests do)

1. **Funding and the token.** A non-zero bond or window without the hub token is refused (401). With it, `fundBonded` is submitted. With both zero, plain `fund` needs no token.
2. **Release opens review.** A v2 release whose receipt carries `Delivered` leaves the job `delivered`, and `/orders` shows `in_review` with `reviewEndsAt` in ms.
3. **Accept.** The job becomes `released` with `acceptTx`.
4. **Dispute.** The order reads `refunded` / `dispute_refund` with `refundable` `"0"`.
5. **Release after the window.** Before `review_ends_at` it is refused `review_open`. After it, the job is released with `releasedAfterWindow` true.
6. **Fail.** Without the token: 401. With it: `refunded` / `delivery_failed`, with `bondSlashed` equal to the bond.
7. **v1 stays v1.** A v1 job refuses each of the four v2-only routes with `not_supported_on_v1`, and its release, cancel and refund still work.
8. **Merchant service.** A refund on an `in_review` order goes to `/escrow/cancel`.
9. **Reconcile.** Chain statuses 4, 5 and 6 map as in section 8.
10. **Existing tests.** Every existing relay test still passes, including cs-w1's `w1-attacks.test.ts`.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #98`, with no emoji and no `Co-authored-by`.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- the merged `EscrowOps` or ABI differs from what this packet names;
- a failure survives three different fixes;
- 60 minutes have passed.

## Report

Write `$M/reports/wc-09-escrow-v2-relay.md`.
