# wc-02 — escrow through the relay, and the `whitechain` rail (revision 2)

> Revision 2. orch-cs's `escrowRail` in `packages/rail/src/escrow/` already does the countersign `challenge` and `verify`, and its `fundArgs`, against the real escrow bytecode. This packet **reuses** that code and does not re-implement it. The relay adds only what a facilitator needs on top: guarded gas-paid submission, a jobs ledger, orders for the merchant, and HTTP endpoints. One source of truth for the checks means the hub and the relay can never disagree about whether a payment is valid.

## Goal

1. **The relay settles x402 scheme `countersign` on Whitechain Sepolia.** Verification is delegated to `escrowRail(...).verify`, then `relayer.simulate`. Settlement submits `CountersignedEscrow.fund` through the existing `Relayer` pipeline, which carries the allowlist, simulation, fee cap, hourly ceiling, balance floor and serial queue. The relay also submits `release`, `cancel` and `refund`, and records jobs.
2. **The merchant sees one list of orders**, both direct `exact` payments and escrow jobs. The one-click refund picks the right action for each order:
   - a job still held in escrow gets a seller-signed `cancel`;
   - anything already paid gets a gasless USDT transfer back. That path already exists in `refund.ts`.
3. **`packages/rail/src/whitechain/`** wraps `escrowRail` with Whitechain's config.
   - `challenge` and `status` come from the wrapped rail.
   - `verify`, `settle`, `release`, `cancel` and `refund` go to the relay over HTTP, which makes the relay the x402 facilitator.

All tests run offline.

## Lease

- `packages/relay/**`
- `packages/rail/src/whitechain/**`
- `packages/rail/test/whitechain.test.ts`

Do not edit:

- `packages/rail/src/rail.ts`, `packages/rail/src/escrow/**`, `packages/rail/src/index.ts`, `packages/rail/package.json`;
- `packages/core/**`, `bun.lock`, the root `package.json`.

You may add `"@countersign/rail": "workspace:*"` to `packages/relay/package.json`. Run `bun install` afterwards, and never commit `bun.lock` (`git checkout -- bun.lock` before each commit). The whitechain rail must not import `@countersign/relay`; it talks to the relay over HTTP only.

## Context

Read these first:

- `packages/rail/src/escrow/index.ts`: `escrowRail(cfg)`, `fundArgs(offerHash, payload)`, `STATUS`, `priceInToken`. Also `escrowAbi` in `packages/rail/src/escrow/abi.ts`.
  - `escrowRail` with no `submitter` can still `challenge`, `verify` and read `escrow.status`.
  - It reads the chain only through `publicClient.readContract`.
  - Pass `publicClient` explicitly. In tests, a fake that implements `readContract` is enough: `as unknown as PublicClient<Transport, Chain>`.
- `packages/rail/src/rail.ts`: `Rail`, `RailDeclaration`, `EscrowOps`.
- `packages/rail/test/escrow.test.ts`: how a valid countersign payload is built with core's helpers.
- `packages/core/src/countersign.ts`: `authorizationTypedData`, `countersignPayload`, `cancelTypedData`, `jobIdOf`.
- `packages/core/src/types.ts`: `CountersignPayload`, `CountersignExtra`, `PaymentPayload`, `PaymentRequirements`, `SettleResult`, `VerifyResult`.
- `packages/relay/src/*`, especially `relayer.ts` (the exhaustive `RelayCall` union), `exact.ts`, `refund.ts`, `ledger.ts`, `server.ts`, `merchant.ts`, `merchant-server.ts` and `test/support.ts` (`FakeChain`).
- `contracts/deployments/whitechain-sepolia.json`: escrow `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4`, USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, chain 1874.

Whitechain config for `escrowRail`:

| Field | Value |
|---|---|
| `id` | `"whitechain"` |
| `chainId` | `1874` |
| `rpcUrl` | `https://rpc.testnet.whitechain.io` |
| `escrow` | `0x9279…7eb4` |
| `token` | USDT |
| `tokenName` | `"Tether USD"` |
| `tokenVersion` | `"1"` |
| `symbol` | `"USDT"` |
| `decimals` | `6` |
| `explorerTx` | `"https://explorer.testnet.whitechain.io/tx/{tx}"` |
| `finality` | `"Final one Whitechain block, about a second, after release."` |
| `gasPaidBy` | `"relayer"` |

Never use `https://rpc-testnet.whitechain.io`. That host is a different chain, 2625.

## What to build

### A. Relay

1. **`src/whitechain-config.ts`** — `whitechainEscrowConfig(overrides)`, which returns the `EscrowRailConfig` above without a submitter. Use it on both sides.

2. **`src/relayer.ts`** — extend `RelayCall` with:
   - `{ kind: "escrowFund", escrow, offerHash, payload: CountersignPayload }` (encode it with `fundArgs`);
   - `{ kind: "escrowRelease", escrow, jobId, slipHash, sellerSig }`;
   - `{ kind: "escrowCancel", escrow, jobId, sellerSig }`;
   - `{ kind: "escrowRefund", escrow, jobId }`.

   Add `allowedEscrows: Address[]` to `RelayerPolicy`. An escrow call to an escrow that is not listed is refused as `not_allowed`. All other `submit` steps stay as they are. In `config.ts`, `RELAY_ESCROW` defaults to the escrow above.

3. **`src/ledger.ts`** — add a `jobs` table and an orders view.
   - **Columns:** `job_id` (PK), `offer_hash`, `buyer`, `payee`, `amount` (TEXT), `deadline` (INTEGER, unix s), `fund_tx`, `fund_block` (TEXT), `status`, `close_tx` (nullable), `slip_hash` (nullable), `created_at` (ms), `closed_at` (ms, nullable), `resource` (nullable). `status` is one of `pending | funded | released | cancelled | refunded`.
   - **Job methods:** `recordJob`, `getJob`, `closeJob(jobId, status, closeTx, slipHash?)` (only from `funded`), `promoteJob(jobId, block)` (from `pending`), and `listJobs({ payee?, buyer? })`, newest first.
   - **`listOrders({ merchant?, customer? })`** merges payments (kind `exact`) and jobs (kind `escrow`) into `Order`:

     ```
     { id, kind, customer, merchant, amount, refunded, refundable, status, createdAt,
       settleTx, closeTx, refundTxs, offerHash?, deadline?, resource? }
     ```

     Status mapping:
     - payment: `paid`, `partially_refunded` or `refunded`;
     - job: `pending`, `held` (funded), `paid` (released, adjusted for transfer refunds, as for payments), `cancelled` or `refunded`.
   - **Refunds:** transfer refunds against a released job reuse the `refunds` table, with `payment_id = jobId`. `refundable(id)` covers both kinds:
     - a payment, or a released job: amount minus refunds;
     - any other job: 0.
   - **CSV:** `ordersCsv(merchant)`, with the header `date_utc,order_id,kind,customer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls`. Keep `toCsv` working, as an alias or as the old payments-only export.

4. **`src/countersign-scheme.ts`**

   `verifyCountersign(body, ctx)` runs these checks in order. The first failure wins.
   1. The body has the x402 v2 shape. Otherwise `invalid_payload`.
   2. The scheme is `countersign`. Otherwise `invalid_scheme`.
   3. The network is `eip155:1874`. Otherwise `invalid_network`.
   4. `extra.escrow` is in `allowedEscrows`. Otherwise `invalid_payload`.
   5. `accepted` matches the requirements on scheme, network, amount, asset and payTo. Otherwise `invalid_payload`.
   6. `escrowRail(whitechainEscrowConfig({ publicClient: ctx.chainClient, now: ctx.now }))`'s `verify(paymentPayload, paymentRequirements)` passes. If it fails, return `{ isValid: false, invalidReason: <its message> }` unchanged. Its messages are the product's refusal copy, for example "Refused. The price moved after you signed."
   7. `relayer.simulate({ kind: "escrowFund", … })` succeeds. Otherwise `invalid_transaction_state`.

   On success it returns `{ isValid: true, payer }`.

   `settleCountersign(body, ctx)` works like this:
   - **jobId** is `payload.authorization.nonce`. The escrow's check guarantees it equals the jobId.
   - **Idempotent.** A job already recorded as funded, released, cancelled or refunded returns success with its fund tx. A pending job returns `settlement_pending` with its tx.
   - Otherwise it verifies, then calls `relayer.submit(escrowFund, payer)`.
   - **Outcome mapping** is the same as `exact.ts`. On `confirmed`, `recordJob` stores status `funded`, the fund tx, the block, and terms from the payload.
   - **Response:** `SettleResult` plus `jobId`.

   `ctx.chainClient` is the object passed to `escrowRail` as `publicClient`. The server passes the real viem public client; tests pass a fake that implements `readContract`.

5. **`src/escrow-ops.ts`**

   Functions:
   - `releaseJob({ jobId, slipHash, sellerSig })`
   - `cancelJob({ jobId, sellerSig })`
   - `refundJob({ jobId })`
   - `jobStatus(jobId)`: reads `escrowRail(...).escrow.status` and merges the ledger row.

   How they work:
   - **Unknown job:** the job must be in the ledger, or `status` must read `funded`. Otherwise refuse with `job_not_found`.
   - **Submit and close:** submit the matching call. On `confirmed`, `closeJob` sets `released`, `cancelled` or `refunded`.
   - **Return:** `{ ok: true, transaction, url, status }` or `{ ok: false, reason }`.
   - **Bad seller signature:** a release or cancel with a bad seller signature fails in simulation and spends nothing. Write a test for it.

6. **`src/server.ts`**
   - `/supported` lists `exact` and `countersign` on `eip155:1874`.
   - `/verify` and `/settle` dispatch on `paymentRequirements.scheme`.
   - New routes:
     - `POST /escrow/release`, `POST /escrow/cancel`, `POST /escrow/refund` (JSON bodies);
     - `GET /escrow/jobs/:jobId`;
     - `GET /orders?merchant=&customer=` returns `{ orders }`;
     - `GET /orders/:id` adds refunds and explorer URLs;
     - `GET /orders.csv?merchant=` (`text/csv`, attachment).
   - `/status` adds `escrow`, `token`, `network` and `chainId`.
   - Existing routes stay.

7. **`src/merchant.ts`**
   - `signCancel({ merchant, escrow, jobId })` signs with core's `cancelTypedData(1874, escrow, jobId)`.

   **`src/merchant-server.ts`**
   - `POST /orders/:id/refund { amount? }`:
     - It works with no body; that is the one click.
     - Fetch `/orders/:id` from the relay and check that `merchant === me`. If it doesn't, return 403.
     - Kind `escrow` and status `held`: sign `Cancel` and call the relay's `/escrow/cancel`.
     - Status `paid` or `partially_refunded` (either kind): sign the EIP-3009 transfer back, as `signRefund` does today, and call the relay's `/refund` with `paymentId = order.id`. `refund.ts` must accept a released job id there.
     - Anything else: 409 `{ ok: false, reason: "not_refundable" }`.
   - `GET /orders` and `GET /orders.csv` proxy the relay with `merchant = me`.
   - Keep the existing routes and CORS.

### B. `packages/rail/src/whitechain/index.ts`

`whitechainRail({ relayUrl, rpcUrl?, escrow?, fetch?, publicClient? })` returns a `Rail`.

- Build `base = escrowRail({ …Whitechain config, no submitter })`.
- `declaration` is `base.declaration`. Its `gasPaidBy` is `"relayer"`.
- `challenge` is `base.challenge`.
- `verify` and `settle` POST `{ x402Version: 2, paymentPayload, paymentRequirements }` to `${relayUrl}/verify` and `${relayUrl}/settle`, and return the JSON.
  - A network error or a reply that isn't JSON maps to `relay_unreachable`.
  - For settle that response is `{ success: false, errorReason: "relay_unreachable", transaction: "", network }`.
- `escrow.release`, `escrow.cancel` and `escrow.refund` call the relay endpoints and map the result to `SettleResult` with `transaction` = tx hash and `network`.
- `escrow.status` is `base.escrow.status`.
- Export `whitechainRail`, `WHITECHAIN_USDT` and `WHITECHAIN_ESCROW`.

## Tests (offline)

**Relay, countersign**
- Build the payload the way `packages/rail/test/escrow.test.ts` does, with a throwaway buyer and a fake chain client that answers `readContract`: balance, `authorizationState` and `jobOf`.
- Cases:
  - happy path;
  - moved price, with the exact message "Refused. The price moved after you signed.";
  - an escrow not on the allowlist;
  - wrong network;
  - wrong scheme;
  - a failed simulation;
  - settle success recording the job;
  - settle idempotency returning the same tx.

**Relay, escrow ops**
- release, cancel and refund each close the job with the right status;
- an unknown job;
- a simulation failure with zero writes.

**Relay, orders**
- a mixed list of payments and jobs;
- the status mapping;
- a transfer refund against a released job;
- the `ordersCsv` header and rows.

**Merchant server.** Run the relay app on `Bun.serve({ port: 0 })` on localhost, backed by fakes.
- held escrow order → `/escrow/cancel`;
- paid exact order → `/refund`;
- cancelled order → 409;
- another merchant's order → 403.

**Rail** (`packages/rail/test/whitechain.test.ts`, with a stub `fetch`)
- the declaration fields;
- `challenge` equals `base.challenge`, honouring `payTo.whitechain`;
- `verify` and `settle` forward the bodies;
- relay errors map to `relay_unreachable`;
- each escrow op hits the right endpoint.

## Constraints

- Every existing test keeps passing, and `exact` behaviour does not change.
- No floats for money. Every bigint crosses JSON as a digit string.
- Never log bodies, signatures or keys.
- Small present-tense commits, no emoji, no `Co-authored-by`.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All four green from the worktree root. `git diff --stat cs/wc...HEAD` lists only lease paths and `.packets/`.

## Stop conditions

Stop, commit what works, and report if any of these happen:

- a needed change falls outside the lease;
- `escrowRail` cannot be driven with an injected client;
- the same failure survives three different fixes;
- 110 minutes have passed.

## Report

Write `$M/reports/wc-02-escrow-rail.md` covering:

- what was built;
- test counts;
- every deviation, with its reason;
- what orch-cs must wire, at least `export * from "./whitechain/index.ts"` in `packages/rail/src/index.ts`.
