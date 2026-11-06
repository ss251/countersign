# wc-09: the Whitechain relay and rail speak escrow v2

Issue: #98. **Design: decided.** cs-wc wrote it on Opus against Rajdeep's v2 contract (PR #164, `9240aec`) and the fleet's v2 wiring on `cs/int`: `EscrowOps` in `packages/rail/src/rail.ts`, the hub's `review.ts`, `bond.ts`, `janitor.ts` and `call.ts`, and core's v2 terms. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

This replaces the earlier wc-09, which followed a design the captain replaced at 19:40 IST: an arbiter-supplied bond in `fundBonded`, and a hub token on funding.

## Starts only when both hold

1. **#164 is merged** into `cs/int`, with the v2 contract and option (d).
2. **v2 is deployed on 1874.** cs-wc has deployed and verified it per `$M/wc/DEPLOY-1874-v2.md` and filled in the address below. Until then `<V2_ADDRESS>` is a placeholder; do not start.

**Decided by the captain at about 21:20 IST:**

- **Production on v2: yes.** After the deploy, the live Whitechain path switches to v2. v1 is the one-step fallback.
- **Option (d):** a bonded job (`cs.bond > 0`) funds only through the arbiter. That is the relay key, which already submits every fund on 1874.

`WHITECHAIN_ESCROW_V2 = <V2_ADDRESS>`, with the relay key `0xa2EEfc657138eE5367291F8e2Ac45BAC28486006` as its arbiter.

## The contract you are wiring (v2, from `contracts/src/CountersignedEscrow.sol`)

| Function | Who can submit | What it does |
|---|---|---|
| `fund(offerHash, cs)` | Unbonded: anyone. **Bonded (`cs.bond > 0`): only the arbiter (option d), which is the relay key.** The relay submits every fund, so both work through it. | `cs` is the 12-field `Countersignature`, which includes `bond` and `reviewWindow`. The jobId uses the v2 typehash. |
| `release(jobId, slipHash, sellerSig)` | Anyone with the payee's `Release` signature | Window 0: pays out. Window > 0: the job becomes **Delivered** and no money moves. |
| `accept(jobId, buyerSig)` | Anyone with the buyer's `Accept(jobId, slipHash)` signature | Delivered → Released |
| `dispute(jobId, buyerSig)` | Anyone with the buyer's `Dispute(jobId)` signature | Funded (until the deadline) or Delivered (until `endsAt`) → Disputed, and the buyer is refunded |
| `releaseAfterWindow(jobId)` | Anyone, after `endsAt` | Delivered → Released |
| `cancel(jobId, sellerSig)` | Anyone with the payee's `Cancel` signature | Funded (until the deadline) or Delivered → Refunded |
| `refund(jobId)` | Anyone, after `deadline + 600` | Funded → Refunded, and the bond goes to the buyer |
| `failDelivery(jobId)` | **The arbiter only**, which is the relay key | Funded (until `deadline + 600`) → Failed, and the buyer gets amount + bond |

`reviewOf(jobId)` returns `(window, deliveredAt, endsAt)` in seconds. `bondOfJob(jobId)` returns the bond in atomic units. The `Job` struct and `jobOf` are unchanged from v1.

## Decisions

### A. The rail: `packages/rail/src/whitechain/index.ts`

1. **The v2 address.** Export `WHITECHAIN_ESCROW_V2: Address = getAddress("<V2_ADDRESS>")` next to `WHITECHAIN_ESCROW`.
2. **New options.** `WhitechainRailOptions` gains `version?: 1 | 2` (default 1) and `relayToken?: string`.
   - `escrow` defaults to `WHITECHAIN_ESCROW` when the version is 1 and to `WHITECHAIN_ESCROW_V2` when it is 2.
   - Pass `version` through to the base `escrowRail`, so its `challenge`, `verify`, `status` and `reviewOf` are v2.
3. **The `escrow` ops object on version 2.** Next to today's `release`, `cancel`, `refund` and `status`, it gains:

   | Method | How |
   |---|---|
   | `accept(jobId, buyerSig)` | `POST ${relayUrl}/escrow/accept` with `{ jobId, buyerSig }` |
   | `dispute(jobId, buyerSig)` | `POST ${relayUrl}/escrow/dispute` with `{ jobId, buyerSig }` |
   | `releaseAfterWindow(jobId)` | `POST ${relayUrl}/escrow/release-after-window` with `{ jobId }` |
   | `failDelivery(jobId)` | `POST ${relayUrl}/escrow/fail` with `{ jobId }` and the header `authorization: Bearer ${relayToken}`. **Defined only when `relayToken` is set.** Without it the method is absent, so the hub falls back to the deadline refund, as today. |
   | `reviewOf`, `tollBps` | From the base escrow rail; these are local chain reads. |
   | `disputeWindowSeconds` | The base rail's value: 600 on v2. |

   Each relay reply maps to a `SettleResult` exactly as `release` maps it today. **Version 1 stays byte-for-byte as it is.**
4. **The hub line.** `apps/hub/src/rails.ts` is orch-cs's file, and orch-cs agreed this one line:

   ```ts
   whitechainRail({ relayUrl: env.WC_RELAY_URL, version: env.WC_ESCROW_VERSION === "2" ? 2 : 1, relayToken: env.WC_RELAY_TOKEN?.trim() || undefined })
   ```

   If `apps/hub/src/network.ts` exists on your base (PR #97's guard), list `WC_ESCROW_VERSION` and `WC_RELAY_TOKEN` there as config of the `whitechain` rail. `WC_RELAY_TOKEN` is a secret. **Do not edit any test to make the guard pass.**

### A2. The buyer's pins and the one-step fallback

4b. **Pin both escrows.** In `packages/buyer/src/known-rails.ts`, add a 1874 v2 entry beside the existing v1 entry. Leave the v1 entry exactly as it is, so a buyer accepts whichever escrow the hub quotes. The v2 entry is:

   ```ts
   { network: "eip155:1874", chainId: 1874, escrow: "<V2_ADDRESS>", token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", tokenName: "Tether USD", tokenVersion: "1", rpcUrl: "https://rpc.ankr.com/whitechain_testnet", version: 2 }
   ```

4c. **The fallback is one env change.** With `WC_ESCROW_VERSION` unset or `1`, the hub quotes v1 again. The relay keeps both escrows allowed and buyers keep both pins, so nothing else moves. Jobs already funded on v2 keep closing on v2, because every operation uses the job's own escrow (decision 10).

### B. The relay: `packages/relay`

5. **Two escrows.**
   - **Allowed escrows:** `allowedEscrows` is v1 (`RELAY_ESCROW` or `WHITECHAIN_ESCROW`) **and** v2 (env `WC_ESCROW_V2` or `WHITECHAIN_ESCROW_V2`).
   - **Version by address:** add `escrowVersion(address): 1 | 2`.
   - **Startup reads:** `/status` and the toll read keep using v1 as the "first" escrow, and gain an `escrowV2` field.
6. **The hub token.** Env `RELAY_HUB_TOKEN` is optional, and must be at least 24 characters when set; refuse to start otherwise.
   - **How it is checked:** compare it in constant time, with `timingSafeEqual` on equal-length buffers; a length mismatch means unequal.
   - **Never** log it, echo it or put it in argv.
7. **Settle (the countersign scheme).** Verify and fund on the escrow the payment requirements name, which must be allowed.
   - **For v2:** use an escrow rail built with `version: 2`, and fund through `fundArgsV2` (export it from `packages/rail` if it is not already exported).
   - **Record the escrow** on the job.
   - **v1 settles exactly as today.**
8. **New relayer call kinds** in `relayer.ts`. The v2 calls use the v2 ABI (`escrowV2Abi`, exported from `packages/rail`) and go through the same guards: allowlist, simulation first, fee cap, hourly ceiling, balance floor, one at a time.

   | Kind | Contract call |
   |---|---|
   | `escrowAccept` | `accept(jobId, buyerSig)` |
   | `escrowDispute` | `dispute(jobId, buyerSig)` |
   | `escrowReleaseAfterWindow` | `releaseAfterWindow(jobId)` |
   | `escrowFailDelivery` | `failDelivery(jobId)` |

   `escrowFund` gains `version`. On 2 it calls v2 `fund` with `fundArgsV2`.

   **Each job uses its own escrow.** The existing `escrowRelease`, `escrowCancel` and `escrowRefund` call the escrow the job was funded on, v1 or v2. Their signatures are identical on both. A bonded job's runner `Cancel` (option d: the runner signs `Cancel` on a refusal or an error) arrives through `/escrow/cancel` as today, and the relay submits it on the job's escrow.
9. **New routes in `server.ts`.** All of them answer like `/escrow/release` does today:
   - 200 `{ ok: true, transaction, url, status }`;
   - 404 `job_not_found` for a job the ledger does not hold;
   - **409 `not_supported_on_v1`** for a job on the v1 escrow;
   - 422 for any other refusal, which includes a simulation revert, so a bad signature costs no gas.

   | Route | Body | Guard |
   |---|---|---|
   | `POST /escrow/accept` | `{ jobId, buyerSig }` | None: the chain checks the buyer's signature. |
   | `POST /escrow/dispute` | `{ jobId, buyerSig }` | None, as above. |
   | `POST /escrow/release-after-window` | `{ jobId }` | None: the clock authorises it. |
   | `POST /escrow/fail` | `{ jobId }` | `authorization: Bearer <RELAY_HUB_TOKEN>`. 503 `fail_not_configured` when the relay has no token; 401 `hub_auth_required` when the header is missing or wrong. **No relayer call is made before the token passes.** |

10. **The ledger, `ledger.ts`.** Add each column with `ALTER TABLE` only when it is missing, as wc-08 did.
    - **Per-job escrow:** `jobs.escrow TEXT NULL`. Existing rows read as v1.
    - **New statuses:** `JobStatus` gains `delivered`, `disputed` and `failed`.
    - **New columns:**
      - `delivered_at`, `review_ends_at` (both milliseconds) and `review_window` (seconds);
      - `bond` (atomic units, read from `bondOfJob` at fund; "0" when there is none);
      - `close_via TEXT NULL`, holding `"accept"` or `"window"`.
    - **Transitions:**
      - **v2 release:** after the receipt, read `reviewOf(jobId)`. If `endsAt > 0`, the job becomes `delivered`, with `delivered_at`, `review_ends_at` and `review_window` recorded, and it is not closed. Otherwise it becomes `released`.
      - **`accept`** gives `released` with `close_via = "accept"`. **`releaseAfterWindow`** gives `released` with `close_via = "window"`.
      - **`dispute`** gives `disputed`. **`failDelivery`** gives `failed`. **v2 `refund`** gives `refunded`.
      - **`cancel`** gives `cancelled` from `funded` **or** `delivered`.
    - **`closeJob`** accepts `delivered` rows as well as `funded`.
11. **Orders** (`/orders`, `/orders/:id`, `orders.csv`), per `$M/wc/orders-contract.md` ("v2"):

    | Job | Order |
    |---|---|
    | `delivered` | status `in_review`, with `deliveredAt`, `reviewEndsAt` (ms) and `reviewWindow` (s) |
    | `released` via accept | as `paid`, plus `acceptedAt` and `acceptTx` (the close tx) |
    | `released` via the window | as `paid`, plus `releasedAfterWindow: true` |
    | `disputed` | status `refunded`, `closeKind: "dispute_refund"` |
    | `failed` | status `refunded`, `closeKind: "delivery_failed"` |

    - **`bondSlashed`:** set to the job's bond when the seller lost it, which is a dispute of a Delivered job, a `failDelivery`, or a v2 refund after the settle window. Otherwise it is absent.
    - **The CSV** keeps its 14 columns unchanged.
12. **The merchant service.** `escrow-ops` `close()` also accepts a `delivered` job, so the merchant can cancel during review. That refunds the buyer in full and returns the bond. The whole-amount rule for held and in-review escrow stays as wc-08 made it.

## Lease

- `packages/relay/src/*` and `packages/relay/test/*`.
- `packages/rail/src/whitechain/*` and `packages/rail/test/whitechain*.test.ts`.
- `packages/rail/src/index.ts`, for exports only (`escrowV2Abi`, `fundArgsV2`).
- `packages/buyer/src/known-rails.ts`, to add the 1874 v2 entry only (decision 4b), and its test.
- `apps/hub/src/rails.ts`, the whitechain line only.
- `apps/hub/src/network.ts`, to classify the two env names only, if it exists.

Touch nothing else, and no view code. Never commit `bun.lock`.

## Tests (no network: simulated chain reads and relayer, as the existing relay tests do)

1. **Config.** `allowedEscrows` holds v1 and v2. A `RELAY_HUB_TOKEN` shorter than 24 characters refuses to load.
2. **Settle.** On v2 it funds through `fundArgsV2`, with `bond` and `reviewWindow` in the struct, on the v2 escrow, and records the escrow. v1 settle is unchanged.
3. **Accept, dispute and release-after-window.** The happy path for each. A job the ledger does not hold gives 404. A v1 job gives 409 `not_supported_on_v1`. A bad body gives 400. A simulation revert gives 422 and sends nothing.
4. **`/escrow/fail`.**
   - With no token configured: 503.
   - A missing header, a wrong token of the same length, and a wrong token of another length: each gives 401, with **no** relayer call.
   - The right token submits `failDelivery`.
5. **Ledger transitions.**
   - v2 release with window 0 gives `released`.
   - With a window, it gives `delivered`. From there:
     - `accept` gives `released` (accept);
     - `releaseAfterWindow` gives `released` (window);
     - `dispute` gives `disputed`;
     - `cancel` gives `cancelled`.
   - `fail` gives `failed`.
6. **Orders.** Each mapping in decision 11, including `bondSlashed`. The CSV header is unchanged.
7. **The rail.**
   - Version 2's ops call the right relay routes with the right bodies.
   - `failDelivery` sends the bearer token, and is absent without `relayToken`.
   - `disputeWindowSeconds` is 600 on v2.
   - The version 1 rail is unchanged.
7b. **The fallback.** A buyer with both 1874 pins accepts a v1 quote and a v2 quote. A v2 job's release, cancel and refund go to the v2 escrow, and a v1 job's go to v1.
7c. **Option (d).** A bonded v2 settle funds through the relay. In the simulated chain, its account is the arbiter.
8. **Existing tests.** All of them pass **unedited**. Do not rewrite, weaken, skip or delete a test (captain's rule, STEER-2050). If a test asserts something genuinely wrong, stop and report it.

## Constraints

- **No browser** of any kind on this machine.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #98`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 40 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-09-escrow-v2-relay.md`.

## After the worker (cs-wc, not the worker)

1. **Review.** Review the diff, gate it, and post REVIEW-REQ to cs-w1, because this is a money path.
2. **PR.** Open it titled `#98 ...`.
3. **Deploy.** After it is promoted:
   - redeploy the relay with `deploy/railway/deploy-relay.sh`, adding `RELAY_HUB_TOKEN` through `--stdin`;
   - orch-cs sets `WC_ESCROW_VERSION=2` and `WC_RELAY_TOKEN` (the same token, through `--stdin`) on the hub;
   - orch-cs adds the buyer's 1874 v2 pin with `version: 2`, and cs-phone adds the `KNOWN_ESCROWS` v2 entry;
   - restart the merchant's runner.
4. **Prove it.** One paid call on v2 through production, with its fund and release read back on chain.
