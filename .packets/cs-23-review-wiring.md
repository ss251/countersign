# cs-23-review-wiring: the hub serves escrow v2 as the project lead decided at 19:40 (refs #98)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-23`, cut from `cs/int`.

## The design is decided (orch-cs)

Read these first:

- `docs/spec/escrow.md`, the section "Escrow v2", which includes the audit fixes;
- D12 and D15 in `docs/decisions.md`.

The contract half (`contracts/**`) is Rajdeep's and does not exist yet. You build the hub and rail side against the interface the spec fixes, and you never touch `contracts/**`. The interface, STEER-1940 as written in the spec (D16), and part 1's parked tests in `contracts/pending/Acceptance.t.sol` (which predate STEER-1940 for funding):

```solidity
struct Countersignature { address buyer; address payee; uint256 amount; uint64 deadline; uint256 salt;
                          uint256 bond; uint64 reviewWindow;              // v2: countersigned inside jobId
                          uint256 validAfter; uint256 validBefore; uint8 v; bytes32 r; bytes32 s; }
function fund(bytes32 offerHash, Countersignature cs) returns (bytes32 jobId); // open to anyone with the countersignature
function failDelivery(bytes32 jobId);                    // the arbiter's only power, until settleBy
function accept(bytes32 jobId, bytes buyerSig);          // buyer's Accept(jobId, slipHash), or msg.sender == buyer with ""
function dispute(bytes32 jobId, bytes buyerSig);         // buyer's Dispute(jobId), or msg.sender == buyer with ""
function releaseAfterWindow(bytes32 jobId);              // anyone, after endsAt
function reviewOf(bytes32 jobId) view returns (uint64 window, uint64 deliveredAt, uint64 endsAt);
function bondOfJob(bytes32 jobId) view returns (uint256);
function setTerms(bytes32 offerHash, uint256 price, uint256 bond, uint64 reviewWindow, uint64 minDuration); // payee only
function sweepToll();                                    // anyone
uint64 constant DISPUTE_WINDOW = 600;                    // settleBy = deadline + DISPUTE_WINDOW
// Status: 0 None, 1 Funded, 2 Released, 3 Refunded, 4 Failed, 5 Delivered, 6 Disputed
```

There is no `fundBonded` and no payee lock signature. Both are withdrawn by STEER-1940.

**Core already has the v2 countersignature** (`cs/int` 4f9bb88). Terms that carry `bond` and `reviewWindow` derive the v2 `jobId` through `jobIdOf`, `authorizationTypedData` and `checkCountersign`; terms without them stay v1. Do not change `packages/core`.

Behaviour you rely on:

- **`release` on a job whose window is greater than 0** leaves it Delivered (5), with `endsAt = deliveredAt + window`.
- **The time boundaries.** "Until T" means `now <= T`; "after T" means `now > T`.
  - `release` and `failDelivery` run until `settleBy`.
  - `refund` runs after `settleBy`.
  - `dispute` on a Funded job runs until `deadline`.
  - `dispute` on a Delivered job runs until `endsAt`.
  - `releaseAfterWindow` runs after `endsAt`.
- **v1 escrows,** the deployed ones, have none of this. Every v1 path must behave exactly as today.

## Build

### 1. Rail (`packages/rail`)

- **The `EscrowOps` interface** (`src/rail.ts`).
  - Add optional methods: `accept(jobId, buyerSig)`, `dispute(jobId, buyerSig)`, `releaseAfterWindow(jobId)`, `reviewOf(jobId) -> {window, deliveredAt, endsAt}` in seconds, and `sweepToll()`.
  - Add a `disputeWindowSeconds` number: 0 on v1, 600 on v2.
  - `status()` gains `"delivered"` and `"disputed"`.
- **The escrow rail** (`src/escrow/index.ts`).
  - Its config gains `version?: 1 | 2`, default 1. Only version 2 exposes the new methods.
  - Keep a hand-written fragment of the functions above in `src/escrow/abi-v2.ts`, with a header saying it is replaced by the generated ABI when the contract lands. It includes `fund` with the v2 `Countersignature` struct in exactly the field order above.
  - **The v2 challenge (402)** puts these in `extra`:
    - `bond`: `offer.bond` as an atomic string, default `"0"`;
    - `reviewWindow`: `offer.reviewWindow`, default 0;
    - `escrowVersion: 2`.
  - **The v2 `verify` and `settle`** require v2 terms (`isV2Terms`) whose `bond` and `reviewWindow` equal those `extra` values. Otherwise they fail with "Refused. The countersigned bond or review window is not the offer's." and send nothing.
  - **The v2 `settle`** calls `fund(offerHash, cs)` with `bond` and `reviewWindow` from the terms. A v1 rail refuses v2 terms and settles exactly as today.
- **Env** (`apps/hub/src/rails.ts`): the escrow rail's version comes from `ARC_ESCROW_VERSION` (`1` or `2`), default 1.

### 2. Hub (`apps/hub`)

- **Store.** Add nullable job columns with an additive migration (ALTER TABLE ADD COLUMN, guarded):
  - `review_window` (seconds);
  - `delivered_at`, `ends_at` (unix seconds);
  - `review_outcome` (`accepted` | `disputed` | `window-elapsed`);
  - `review_tx`.
  - Job statuses gain `"delivered"` and `"disputed"`.
- **The call path** (`call.ts`). After the gate passes and `release` succeeds on a v2 rail whose job has `reviewWindow > 0`:
  - read `reviewOf(jobId)`;
  - store the job as `"delivered"` with its window, `delivered_at` and `ends_at`;
  - put `settlement.review = {window, deliveredAt, endsAt}` on the slip the buyer receives, outside the hash (D12).
  - Every other path is unchanged.
- **Gate failure** (`bond.ts` `failOnGate`). On v2, call `failDelivery` only while `now <= deadline + disputeWindowSeconds`. After that, return null: the refund pays the buyer.
- **New routes** in a new file `review.ts`, registered in `app.ts`: `POST /jobs/:jobId/accept` and `POST /jobs/:jobId/dispute`, with body `{ "sig": "0x…" }`.
  - **404** `unknown-job` when no such job.
  - **409** `not-reviewable` when the state does not allow it:
    - `accept` needs `"delivered"`;
    - `dispute` needs `"funded"` with `now <= deadline`, or `"delivered"` with `now <= ends_at`;
    - the escrow rail must be v2.
  - **401** `bad-signature` unless the signature recovers to the job's buyer. Check it before any transaction:
    - `acceptTypedData(chainId, escrow, jobId, slipHash)` for accept;
    - `disputeTypedData(chainId, escrow, jobId)` for dispute;
    - both from `@countersign/core`.
  - **On success:**
    - submit through the rail's `escrow.accept` or `escrow.dispute`;
    - store the outcome: accept makes the status `"released"` with outcome `accepted`, and dispute makes it `"disputed"` with outcome `disputed`;
    - store `review_tx`, and set `closeTx` to the review transaction;
    - answer `200 {jobId, status, tx}`.
  - **On a failed transaction:** answer `502` `review-failed`, and change nothing.
  - No hub token: the buyer's signature is the authority.
- **Janitor** (`janitor.ts`).
  - It calls `releaseAfterWindow` for `"delivered"` jobs past `ends_at`, and stores status `"released"` with outcome `window-elapsed`.
  - It refunds `"funded"` jobs only after `deadline + disputeWindowSeconds` (v1: after `deadline`, as today).
  - Keep the "next pass retries" behaviour.
- **Reads** (`orders.ts`, `buyerplumbing.ts`). `/jobs` and `/orders` serve the review fields from the store, not the static `reviewFields(escrow)`:
  - `reviewWindow`, as today: 0 on v1 escrow jobs, null without an escrow;
  - `deliveredAt` and `reviewEndsAt` in ms, null until delivered;
  - `reviewOutcome`, null until there is one.
  - Keep every existing field and shape.

## Lease

You may create or change only:

- `packages/rail/src/rail.ts`;
- `packages/rail/src/escrow/index.ts` and `packages/rail/src/escrow/abi-v2.ts` (new);
- `packages/rail/test/escrow-v2.test.ts` (new);
- `apps/hub/src/{store.ts,call.ts,bond.ts,janitor.ts,orders.ts,buyerplumbing.ts,app.ts,rails.ts,review.ts}`, where `review.ts` is new;
- `apps/hub/test/review.test.ts` (new), plus existing hub tests only where a review field's value changes;
- `.packets/reports/cs-23-review-wiring.md`.

## Tests

No network. Use fake `EscrowOps` with an injected clock for the hub, and viem's `encodeFunctionData` for the rail.

1. **Rail v2:**
   - the encoded calls for `fund` (v2 struct), `accept`, `dispute`, `releaseAfterWindow` and `sweepToll` use the v2 fragment;
   - the v2 402 carries `bond`, `reviewWindow` and `escrowVersion: 2`;
   - v1 terms on a v2 rail, or a bond or window that is not the offer's, refuse before any transaction;
   - a v1 rail has none of the new methods and settles with `fund` exactly as before.
2. **Routes:**
   - accept on a delivered job: 200, status `released`, outcome `accepted`;
   - dispute on a delivered job inside the window: 200, `disputed`;
   - dispute on a funded job before the deadline: 200;
   - dispute after `ends_at`: 409;
   - dispute on a funded job after its deadline: 409;
   - a signature from anyone but the buyer: 401, and no transaction sent;
   - unknown job: 404;
   - a v1 job: 409;
   - a rail transaction that fails: 502, with the job unchanged.
3. **Janitor:**
   - `releaseAfterWindow` only after `ends_at`, never at `ends_at`;
   - a v2 funded job is refunded only after `deadline + 600`, never at it;
   - a v1 funded job is refunded after `deadline` as today.
4. **Gate:** on v2 after `deadline + 600`, `failOnGate` sends nothing and returns null.
5. **Reads:**
   - `/jobs` and `/orders` show `deliveredAt`, `reviewEndsAt` and `reviewOutcome` from the store;
   - v1 rows keep `reviewWindow: 0`, and non-escrow rows keep null.
6. Every existing rail and hub test passes. List any expectation you changed in the report.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Never touch `contracts/**`. Never deploy, never call a faucet, never use a public RPC.
- No view code. TypeScript strict, no `any`. No new dependencies.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail apps/hub && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #98)`, and no trailers. Write `.packets/reports/cs-23-review-wiring.md`. Do not push, merge or deploy.
