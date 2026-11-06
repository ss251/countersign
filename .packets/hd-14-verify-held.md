# hd-14-verify-held: the standalone verifier verifies a held Hedera slip, and proves its payment on the mirror

## Goal

Issue #163. `packages/verify/src/verify.ts` sends every slip whose payment scheme is `countersign` to the Arc escrow countersignature check. A held Hedera payment (rail `hedera-scheduled`) also uses scheme `countersign`, but it has no terms, authorization or escrow, so the verifier says INVALID: "the slip carries no countersignature to check".

Route by the payment, not the scheme. A held payment is checked as what it is: a Hedera schedule, created by the buyer, that executed and moved exactly the slip's amount to the slip's payee. That check reads the mirror node when one is given.

This gates the project lead's item 4: production pays held only once a held slip verifies VALID. Tracked by issue #163 (refs #41).

## Lease

- `packages/verify/src/verify.ts`
- `packages/verify/src/cli.ts`: the `--mirror` flag and its usage line only.
- `packages/verify/test/held.test.ts` (new).
- Report: `$M/reports/hd-14-verify-held.md`

## The decided design

1. **What counts as a held payment.** A slip is held when `slip.payment.accepted.network` starts with `"hedera:"`, `slip.payment.accepted.extra?.name === "hedera-scheduled"`, and `slip.body.rail === "hedera-scheduled"`.

2. **The countersignature finding.** In `verifySlip`, the branch order is:

   | Slip | Finding |
   |---|---|
   | Held | `checkHeld(slip, add)` (below) |
   | Otherwise, `slip.payment.accepted.scheme === "countersign"` | `checkCountersigned(slip, add)`, unchanged |
   | Otherwise | the existing `"countersignature", true, …` finding, unchanged |

   `checkHeld` adds one finding named `"countersignature"`. It is ok only when all of these hold:
   - `slip.payment.payload.scheduleId` is a string matching `/^0\.0\.\d+$/`;
   - `createTxId` is a string matching `/^0\.0\.\d+@\d+\.\d+$/`;
   - `slip.settlement?.transaction === createTxId`.

   | Outcome | Detail |
   |---|---|
   | ok | `held by Hedera schedule ${scheduleId}, created by ${createTxId}; the seller's countersignature released it` |
   | Missing or malformed ids | `the held payment names no schedule` |
   | Settlement differs | `the slip's settlement ${settlement} is not the schedule's create ${createTxId}` |

3. **The onchain finding for a held slip.** `VerifyOptions` gains two fields:
   - `mirrorUrl?: string`, a mirror node base URL such as `https://testnet.mirrornode.hedera.com`;
   - `fetch?: typeof fetch`, a test seam that defaults to the global fetch.

   For a held slip, the existing `opts.rpcUrl` and escrow branches do **not** apply:
   - With `opts.mirrorUrl` set, call `await checkHeldOnMirror(slip, opts.mirrorUrl, f, add)`.
   - Without it, push to `skipped`: `"onchain: not checked. Pass a Hedera mirror URL (--mirror) to read the schedule's execution."`

   For every other slip, the existing branches are unchanged.

   **`checkHeldOnMirror`** adds exactly one finding named `"onchain"`.
   - **Inputs.** It uses only plain `fetch` and JSON. Let `id = createTxId.replace("@", "-").replace(".", "-")`, applied to the part after `@` only, giving the mirror form `0.0.X-<seconds>-<nanos>`, and `base = mirrorUrl` without a trailing slash.
   - **The checks, in order.** The first failure gives `ok: false` with the detail in brackets.
     1. **The create** (`not the buyer's create of this schedule`). `GET ${base}/api/v1/transactions/${id}` answers 200, with a `transactions` entry where `name === "SCHEDULECREATE"`, `entity_id === scheduleId` and `result === "SUCCESS"`. Also, the account part of `createTxId` (before `@`) must equal `slip.body.buyer`.
     2. **The schedule** (`the schedule has not executed`). `GET ${base}/api/v1/schedules/${scheduleId}` answers 200 with a non-null `executed_timestamp`.
     3. **The execution.** `GET ${base}/api/v1/transactions/${id}?scheduled=true` answers 200, with a `transactions` entry whose `result === "SUCCESS"` and whose `consensus_timestamp === executed_timestamp` (`the schedule's execution record is missing`). Its `token_transfers` on `token_id === slip.body.asset` must net exactly `+BigInt(body.amount)` for `slip.body.payTo` and `-BigInt(body.amount)` for `slip.body.buyer`; sum the entries per account, with amounts as `BigInt(String(x))` (`the execution moved a different amount or payee`).
     4. A thrown fetch or a non-JSON body gives `mirror read failed: <message>`.
   - **On success** the detail is `schedule ${scheduleId} executed at ${executed_timestamp}: ${body.amount} of ${body.asset} from ${body.buyer} to ${body.payTo}`.

4. **`cli.ts`.**
   - `--mirror <url>` passes `mirrorUrl`.
   - The usage line becomes `usage: verify <slip.json> [--rpc <url>] [--mirror <url>]`, and the doc comment at the top says the same.
   - Both flags can be given together.

## Tests (`packages/verify/test/held.test.ts`; offline, with the fake `fetch` seam)

Build seller-signed slips the way `verify.test.ts` does (`slipBodyFor`, `slipHash`, `slipTypedData`, the test seller key), using the real shapes from a live held purchase.

- **The body.** `rail: "hedera-scheduled"`, `network: "hedera:testnet"`, `buyer: "0.0.11337064"`, `payTo: "0.0.11338176"`, `asset: "0.0.429274"`, `amount: "30000"`.
- **The payment.**

  ```
  { x402Version: 2,
    accepted: { scheme: "countersign", network: "hedera:testnet", amount: "30000", asset: "0.0.429274", payTo: "0.0.11338176", maxTimeoutSeconds: 120, extra: { name: "hedera-scheduled", offerHash: <the body's>, holdSeconds: 300 } },
    payload: { scheduleId: "0.0.11340633", createTxId: "0.0.11337064@1793976332.854132797" } }
  ```

- **The settlement.** `{ transaction: "0.0.11337064@1793976332.854132797", network: "hedera:testnet" }`.
- **The fake mirror.**
  - `/api/v1/transactions/0.0.11337064-1793976332-854132797` gives `{ transactions: [{ transaction_id: "0.0.11337064-1793976332-854132797", name: "SCHEDULECREATE", entity_id: "0.0.11340633", result: "SUCCESS" }] }`.
  - `/api/v1/schedules/0.0.11340633` gives `{ schedule_id: "0.0.11340633", executed_timestamp: "1793976347.287046943" }`.
  - The same transaction path with `?scheduled=true` gives `{ transactions: [{ result: "SUCCESS", consensus_timestamp: "1793976347.287046943", token_transfers: [{ token_id: "0.0.429274", account: "0.0.11337064", amount: -30000 }, { token_id: "0.0.429274", account: "0.0.11338176", amount: 30000 }] }] }`.

**Cases:**
1. **cs-e2e's pair.** The held slip without a mirror is `valid: true`, with onchain in `skipped`. An exact Hedera slip that differs only in its payment (`scheme: "exact"`, `payload: { transaction: "<base64>" }`, settlement a tx id) is also `valid: true`.
2. **With the mirror.** The held slip with `mirrorUrl` is `valid: true`, with an ok `onchain` finding naming the schedule and the execution time.
3. **Countersignature refusals.** Each is `valid: false`, with the exact detail: a payload with no `scheduleId`; a settlement transaction other than `createTxId`.
4. **Mirror refusals.** Each is `valid: false`, with the exact onchain detail:
   - the create is for another schedule;
   - `createTxId`'s account is not the buyer;
   - `executed_timestamp` is null;
   - the execution's consensus time differs;
   - the execution moved 29999;
   - the execution paid another account.
5. **Arc unchanged.** An Arc countersign slip still goes through `checkCountersigned`, and the existing tests pass unedited.

## Constraints

- **No browser.** **No network** in tests. **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Scope.** Change nothing outside the lease. **No new dependencies**: plain fetch only, because the verifier stays standalone. Never stage `bun.lock`. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/verify && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-14` with short present-tense messages ending `refs #163`, and no trailers. Write the report. Do not push, merge or deploy.
