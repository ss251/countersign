# wc-02 — escrow through the relay, and the `whitechain` rail

## Goal

`packages/relay` today settles x402 `exact` payments: a direct USDT transfer with gas paid by the relayer. This packet adds three things.

1. **The relay learns countersign's escrow on Whitechain Sepolia.**
   - It verifies and settles x402 scheme `countersign`, where `settle` calls `CountersignedEscrow.fund`.
   - It submits `release`, `cancel` and `refund` for funded jobs.
   - It keeps a `jobs` table next to `payments`.
2. **The merchant side sees one list of orders.** That list covers direct payments and escrow jobs. The merchant's one-click refund does the right thing for each kind:
   - held in escrow → seller-signed `cancel`;
   - already paid → a gasless USDT transfer back, which already exists.
3. **`packages/rail/src/whitechain/`** implements the `Rail` interface from `packages/rail/src/rail.ts` by calling the relay over HTTP. The hub can then take Whitechain payments without knowing which chain they're on.

Everything is tested offline with fakes.

## Lease

You may create or change only:

- `packages/relay/**`
- `packages/rail/src/whitechain/**`
- `packages/rail/test/whitechain*.test.ts`

Do not edit `packages/rail/src/rail.ts`, `packages/rail/src/index.ts`, `packages/rail/package.json`, `packages/core/**`, `bun.lock` or the root `package.json`.

If `packages/relay/package.json` needs no new dependency, leave it alone. The rail may import `@countersign/core` and `viem`, and nothing from `@countersign/relay`: it talks to the relay over HTTP only.

## Context

Read these first:

- `packages/core/src/types.ts` — `PaymentRequirements`, `PaymentPayload`, `VerifyResult`, `SettleResult`, `CountersignTerms`, `CountersignPayload`, `CountersignExtra`, `Offer`, `RailId`.
- `packages/core/src/countersign.ts`:
  - `jobIdOf`, `escrowDomain`, `authorizationTypedData`, `countersignPayload`;
  - `checkCountersign`, which does the full off-chain check and returns the jobId;
  - `releaseTypedData`, `cancelTypedData`, `CANCEL_TYPES`, `RELEASE_TYPES`.
- `packages/core/src/offer.ts` — `offerHash(offer)`.
- `packages/rail/src/rail.ts` — `Rail`, `RailDeclaration`, `EscrowOps`, `ChallengeContext`.
- `contracts/src/ICountersignedEscrow.sol` and `contracts/src/CountersignedEscrow.sol` — the escrow.
  - Get its ABI with `forge inspect contracts/src/CountersignedEscrow.sol:CountersignedEscrow abi --json` and save it as a `const` in `packages/relay/src/escrow-abi.ts`.
  - You need the `fund`, `release`, `refund`, `cancel`, `jobOf`, `jobIdFor`, `tollOf` and `domainSeparator` functions, the `Funded`, `Released` and `Refunded` events, and the custom errors.
- Everything under `packages/relay/src` and `packages/relay/test`, especially:
  - `relayer.ts`, where `RelayCall` is an exhaustive union;
  - `exact.ts`, `refund.ts`, `ledger.ts`, `server.ts`, `merchant-server.ts`;
  - `test/support.ts`, which has `FakeChain`.
- `contracts/deployments/whitechain-sepolia.json` — the live escrow `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4` on chain 1874.

How the escrow works on chain:

- **`fund(offerHash, Countersignature{buyer, payee, amount, deadline(uint64), salt, validAfter, validBefore, v, r, s})`**
  - It needs `deadline > block.timestamp`.
  - It computes `jobId = EIP-712 Countersign(offerHash, buyer, payee, amount, deadline, salt)` under the domain `{Countersign, 1, 1874, escrow}`.
  - It checks the buyer's EIP-3009 `ReceiveWithAuthorization` signature, whose `to` is the escrow and whose `nonce` is the jobId, under the USDT domain `{Tether USD, 1, 1874, USDT}`.
  - It pulls with `receiveWithAuthorization`, so only the escrow can submit it.
- **`release(jobId, slipHash, sellerSig)`** is payee-signed: EIP-712 `Release(jobId, slipHash)` in the escrow domain. It runs at or before the deadline and pays `amount - toll` to the payee and the toll to the treasury.
- **`cancel(jobId, sellerSig)`** is payee-signed: `Cancel(jobId)`. It runs any time before release and returns the full amount to the buyer.
- **`refund(jobId)`** can be called by anyone, only after the deadline, and returns the full amount.
- **`jobOf(jobId)`** returns `{buyer, deadline, status (0 None, 1 Funded, 2 Released, 3 Refunded), payee, amount, offerHash, slipHash}`.

## What to build

### A. Relay

1. **`src/escrow-abi.ts`** — the escrow ABI `as const`, generated as described above.

2. **`src/relayer.ts`** — extend `RelayCall` with:
   - `{ kind: "escrowFund", escrow, offerHash, cs }`, where `cs` uses bigints and `v` as a number;
   - `{ kind: "escrowRelease", escrow, jobId, slipHash, sellerSig }`;
   - `{ kind: "escrowCancel", escrow, jobId, sellerSig }`;
   - `{ kind: "escrowRefund", escrow, jobId }`.

   Add `allowedEscrows: Address[]` to `RelayerPolicy`. An escrow call is `not_allowed` unless its escrow is listed. Every other step of `submit` (simulate, fee cap, ceiling, floor, serialisation) applies unchanged. Default `allowedEscrows` in `config.ts` comes from `RELAY_ESCROW`, defaulting to `0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4`.

3. **`src/ledger.ts`** — a `jobs` table:
   - **Columns:** `job_id` PK, `offer_hash`, `buyer`, `payee`, `amount` TEXT, `deadline` INTEGER, `fund_tx`, `fund_block` TEXT, `status` (`funded | released | cancelled | refunded | pending`), `close_tx` NULL, `slip_hash` NULL, `created_at` ms, `closed_at` ms NULL, `resource` NULL.
   - **Methods:** `recordJob`, `getJob`, `closeJob(jobId, status, closeTx, slipHash?)` (only from `funded`), and `listJobs({ payee?, buyer? })`, newest first.
   - **Orders:** add `listOrders({ merchant?, customer? })`, which merges payments (kind `exact`) and jobs (kind `escrow`) into one `Order` type: `{ id, kind, customer, merchant, amount, refunded, status, createdAt, settleTx, closeTx, refundTxs, offerHash?, deadline?, resource? }`.
   - **Order status:**
     - payment: `paid`, `partially_refunded` or `refunded`;
     - job: `held` (funded), `paid` (released, minus any transfer refunds against it), `cancelled`, `refunded`, `pending`.
   - **Refunds against a released job:** the existing `refunds` table already keys on `payment_id`. Use the jobId there, so `refundable(id)` works for a released job as well: its amount minus its refunds. A held, cancelled or refunded job is not refundable by transfer.
   - **CSV:** replace `toCsv(payTo)` with `ordersCsv(merchant)`, and keep `toCsv` as an alias. The header is `date_utc,order_id,kind,customer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls`. Escrow rows use the release tx as `close_tx_url`, and the cancel or refund tx when there is one.

4. **`src/countersign-scheme.ts`** — `verifyCountersign(body, ctx)` and `settleCountersign(body, ctx)`. The body has the same x402 v2 shape as `exact`, with `payload` a `CountersignPayload`.

   `verifyCountersign` checks, in order (first failure wins):
   1. `x402Version === 2`, else `invalid_payload`.
   2. scheme `countersign`, else `invalid_scheme`.
   3. network `eip155:1874`, else `invalid_network`.
   4. asset is USDT (case-insensitive), else `invalid_payload`.
   5. `extra.escrow` is in `allowedEscrows`, `extra.chainId === 1874`, and `extra.tokenName`/`extra.tokenVersion` equal `Tether USD`/`1`, else `invalid_payload`.
   6. `accepted` matches the requirements on scheme, network, amount, asset and payTo, else `invalid_payload`.
   7. The payload has the shape of `CountersignPayload` (addresses via `getAddress`, digit strings, a 32-byte nonce), else `invalid_payload`.
   8. `terms.amount === amount`, else `invalid_exact_evm_payload_authorization_value_mismatch`. (This is the moved price. Name it in the test.)
   9. `terms.payee === payTo` and `terms.offerHash === extra.offerHash`, else `invalid_exact_evm_payload_recipient_mismatch`.
   10. `terms.deadline > now + 30` and `terms.deadline <= now + extra.deadlineSeconds + 300`, else `invalid_deadline`.
   11. `checkCountersign(payload, { chainId: 1874, escrow, token: USDT, tokenName, tokenVersion, now })`. `bad-signature` → `invalid_exact_evm_payload_signature`; `terms-mismatch` → `invalid_payload`; `expired` → `..._valid_before`; `not-yet-valid` → `..._valid_after`.
   12. Chain reads: `balanceOf(buyer) >= amount`, else `insufficient_funds`. Then `authorizationState(buyer, jobId)` must be false and `jobOf(jobId).status` must be 0, else `invalid_transaction_state`.
   13. `relayer.simulate(escrowFund)` succeeds, else `invalid_transaction_state`.

   Return `{ isValid: true, payer: buyer }`.

   `settleCountersign` works like this:
   - **Idempotent by jobId.** A recorded job that is funded or later returns `success` with its fund tx. A `pending` job returns `settlement_pending` with its tx.
   - Otherwise it verifies, then submits `escrowFund`. Outcomes map as in `exact.ts`. `confirmed` records the job with status `funded`, the fund tx and the block.
   - The response is `SettleResult` plus `jobId`.

5. **`src/escrow-ops.ts`** — four functions:
   - `releaseJob({ jobId, slipHash, sellerSig })`
   - `cancelJob({ jobId, sellerSig })`
   - `refundJob({ jobId })`
   - `jobStatus(jobId)`, which reads `jobOf` from chain and merges ledger fields.

   Each one:
   - refuses with `job_not_found` unless the job is in the ledger, or `jobOf` on chain shows it funded;
   - submits the matching `RelayCall`;
   - on `confirmed`, calls `ledger.closeJob` with `released`, `cancelled` or `refunded`;
   - returns `{ ok: true, transaction, url, status }` or `{ ok: false, reason }`.

   A release with a bad seller signature must fail in simulation and spend nothing. Test this.

6. **`src/server.ts`**
   - `/supported` lists both kinds: `exact` and `countersign` on `eip155:1874`.
   - `POST /verify` and `POST /settle` dispatch on `paymentRequirements.scheme`. Anything else gets `invalid_scheme`.
   - Add `POST /escrow/release`, `POST /escrow/cancel` and `POST /escrow/refund`, which take JSON bodies.
   - Add `GET /escrow/jobs/:jobId`.
   - Add `GET /orders?merchant=&customer=`, returning `{ orders }`.
   - Add `GET /orders.csv?merchant=`, keeping `/payments.csv` as an alias.
   - Add `GET /orders/:id`, which includes refunds and explorer URLs.
   - `/status` also returns `escrow`, `token`, `network` and `chainId`.

7. **`src/merchant.ts` and `src/merchant-server.ts`**
   - Add `signCancel({ merchant, escrow, jobId })`, which returns an EIP-712 signature using core's `cancelTypedData(1874, escrow, jobId)`.
   - Add `POST /orders/:id/refund { amount? }`. It works with no body (one click). Fetch the order from the relay, check that `merchant === me`, then:
     - kind `escrow`, status `held` → sign `Cancel` and call relay `/escrow/cancel`;
     - kind `exact` or `escrow` with status `paid`/`partially_refunded` → sign an EIP-3009 transfer back, as today, and call relay `/refund` with `paymentId = order.id`;
     - anything else → 409 `{ ok: false, reason: "not_refundable" }`.
   - Add `GET /orders` and `GET /orders.csv`, proxied with `merchant = me`.
   - Keep the existing routes working.

### B. `packages/rail/src/whitechain/index.ts`

`createWhitechainRail({ relayUrl, escrow = 0x9279…7eb4, fetch = globalThis.fetch })` returns a `Rail`.

- **`declaration`:**
  - `id: "whitechain"`, `network: "eip155:1874"`, `scheme: "countersign"`;
  - `asset: { network: "eip155:1874", address: USDT, symbol: "USDT", decimals: 6 }`;
  - `kind: "escrow"`, `escrow`, `gasPaidBy: "relayer"`;
  - `finality: "Final one Whitechain block, about a second, after release."`;
  - `explorerTx: "https://explorer.testnet.whitechain.io/tx/{tx}"`.
- **`challenge(offer, ctx)`** returns:
  - `scheme: "countersign"`, `network`, `amount: offer.price`, `asset: USDT`;
  - `payTo: offer.payTo?.whitechain ?? offer.seller`, checksummed;
  - `maxTimeoutSeconds: offer.deadline`;
  - `extra: { rail: "whitechain", escrow, chainId: 1874, offerHash: offerHash(offer), deadlineSeconds: offer.deadline, tokenName: "Tether USD", tokenVersion: "1" }`, which is a `CountersignExtra`.

  It refuses with a thrown `Error` when `offer.rails` doesn't include `whitechain`.
- **`verify` / `settle`** POST `{ x402Version: 2, paymentPayload, paymentRequirements }` to `${relayUrl}/verify` and `${relayUrl}/settle`. They return the relay's JSON as `VerifyResult` / `SettleResult`. A network error or non-JSON reply becomes `{ isValid: false, invalidReason: "relay_unreachable" }`, or `success: false` with `errorReason: "relay_unreachable"`, `transaction: ""` and the network.
- **`escrow`** (`EscrowOps`):
  - `release`, `refund` and `cancel` call the relay endpoints and return `SettleResult` (`transaction` = tx hash).
  - `status` calls `GET /escrow/jobs/:jobId` and maps the result to `"none" | "funded" | "released" | "refunded"`. Cancelled counts as `refunded`.
- Export `WHITECHAIN_USDT`, `WHITECHAIN_ESCROW` and `createWhitechainRail`.

## Tests (offline)

- **relay, countersign:**
  - Build a real buyer payload with core's `authorizationTypedData` and a throwaway account, against the fake chain extended with escrow `jobOf`/`fund` behaviour.
  - Cover the happy path, with `isValid` and the payer.
  - Cover each refusal: moved price, wrong payee, wrong offerHash, deadline out of range, bad signature, insufficient funds, nonce used, job exists, escrow not allowed, wrong network, wrong scheme.
  - Settle success records a `funded` job.
  - Settle is idempotent and returns the same transaction.
- **relay, escrow ops:**
  - release, cancel and refund on a funded job close it with the right status;
  - an unknown job gives `job_not_found`;
  - simulation failure gives refused, with zero writes.
- **relay, orders:**
  - one exact payment and one escrow job list together;
  - statuses map correctly;
  - a refund by transfer against a released job reduces `refundable`;
  - `ordersCsv` has the header and both kinds.
- **merchant server**, with the relay app served by `Bun.serve({ port: 0 })` on localhost and a fake chain behind it:
  - one-click refund of a `held` escrow order calls `/escrow/cancel`;
  - one-click refund of a `paid` exact order calls `/refund`;
  - a `cancelled` order gives 409.
- **rail**, in `packages/rail/test/whitechain.test.ts` with a stub `fetch`:
  - `challenge` shape, matching `CountersignExtra`, with the payTo override honoured;
  - `verify`/`settle` forward bodies and parse replies;
  - an unreachable relay maps to `relay_unreachable`;
  - escrow ops call the right paths;
  - `status` mapping.

## Constraints

- All existing tests must keep passing. Keep the `exact` behaviour unchanged.
- No floats for money. Bigints cross JSON as digit strings.
- Never log bodies, signatures or keys.
- Small present-tense commits, no emoji, no `Co-authored-by`. Never commit `bun.lock`; run `git checkout -- bun.lock` before committing.
- Do not write the name of any earlier project anywhere. The product name in prose is lowercase `countersign`.

## Acceptance

Run from the worktree root:

```
bun install && bun run typecheck && bun test && forge test
```

All green. `git diff --stat cs/wc...HEAD` lists only lease paths and `.packets/`.

## Stop conditions

Stop, commit what works, and write the report if any of these happen:

- you need a change outside the lease, such as an export from `packages/rail/src/index.ts`;
- the escrow ABI does not match `ICountersignedEscrow.sol`;
- one failure survives three different fixes;
- 110 minutes pass.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-02-escrow-rail.md` covering:

- what was built;
- test counts;
- deviations, each with its reason;
- anything the orchestrator must wire, such as the `packages/rail/src/index.ts` re-export.
