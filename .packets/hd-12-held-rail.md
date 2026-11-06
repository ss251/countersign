# hd-12-held-rail: the hub takes a Hedera schedule as a held payment and releases it only after a checked delivery

## Goal

Build decisions D1 to D8 of `/Users/thescoho/Developer/countersign-mumbai/hd/DESIGN-hedera-held-default.md` exactly. Read it first. It is the captain's item 4 for tonight: Hedera scheduled checkout becomes the default Hedera path, so a failed delivery no longer loses the buyer's money. Tracked by issue #41.

This packet covers the rail and the hub. The runner's countersigner and the agent's held path come next in hd-13. Do not build them here.

## Lease

- `packages/core/src/types.ts`: add `"hedera-scheduled"` to `RAIL_IDS`, nothing else.
- `packages/core/src/wire.ts`:
  - `JobOrder` gains `schedule?: { id: string; createTx: string }`, with a doc comment.
  - The `result` member of `RunnerToHub` gains `countersign?: string`, with a doc comment.
- `packages/rail/src/rail.ts`: `EscrowOps.release` gains an optional fourth parameter, `countersign?: string`, with a doc comment ("the seller's signed release, for rails whose release is a seller signature the hub submits; the Arc escrow ignores it").
- `packages/rail/src/hedera/held.ts` (new) and `packages/rail/src/hedera/index.ts` (one `export *` line).
- `apps/hub/src/delivery.ts`: `BuildOrderInput` and `buildOrder` only.
- `apps/hub/src/runners.ts`: carry `countersign` through the dispatch result only.
- `apps/hub/src/call.ts`:
  - pass `schedule` into `buildOrder`;
  - pass `delivered.countersign` to `escrow.release`;
  - add the `failedDelivery` wording for this rail.
- `apps/hub/src/rails.ts`: the flag and the doc-block line.
- Tests:
  - `packages/rail/src/hedera/test/held.test.ts` (new);
  - `apps/hub/test/held.test.ts` (new);
  - `apps/hub/test/runner-client.ts`: only to let a test's `respond` add `countersign` to the result frame.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-12-held-rail.md`

## The decided design

**1. `held.ts`.** It exports `HEDERA_SCHEDULED_DECLARATION`, `createHederaHeldRail(opts?: HeldRailOptions)` and `heldJobId(createTxId: string): Hex`. `heldJobId` is `keccak256(toBytes(createTxId))` from viem, which is exactly the hub's jobId for a payload with no `authorization.nonce`.

**`HeldRailOptions`.** All fields are optional test seams:

| Option | Default |
|---|---|
| `mirror?: MirrorOptions` | |
| `now?: () => number` | unix seconds |
| `seen?: { has(id): boolean; claim(id): boolean }` | in-memory. Reuse the same interface `rail.ts` uses for its `seen` store if one exists, and say which in the report |
| `submit?: (tx: ScheduleSignTransaction) => Promise<{ status: string }>` | an operator-less `Client.forTestnet()`: `execute`, then `getReceipt`, then close the client. A thrown `ReceiptStatusError` or `StatusError` becomes `{ status: <its status string> }` |
| `waitScheduleMs?: number` | 20 000 |
| `pollMs?: number` | 1 500 |
| `executionTimeoutMs?: number` | 60 000 |

**The declaration.** Use `HEDERA_DECLARATION`'s asset object and decimals:

```
{ id: "hedera-scheduled", network: HEDERA_TESTNET, scheme: "countersign", asset: <as HEDERA_DECLARATION>,
  kind: "escrow", gasPaidBy: "buyer", finality: "Hedera consensus when the seller's countersignature lands",
  explorerTx: `${HASHSCAN_TESTNET}/transaction/{tx}`, finalitySeconds: 5, cost: { tollBps: 0, fixed: "0" } }
```

**`challenge(offer)`.**

- `payTo = offer.payTo?.["hedera-scheduled"]`. If it does not match `/^0\.0\.\d+$/`, throw `Error("offer has no hedera-scheduled payTo")`.
- Return:

  ```
  { scheme: "countersign", network: HEDERA_TESTNET, amount: offer.price, asset: USDC_TESTNET, payTo,
    maxTimeoutSeconds: offer.deadline,
    extra: { name: "hedera-scheduled", offerHash: offerHash(offer), holdSeconds: offer.deadline + 180 } }
  ```

**`verify(payment, req)`.** Mirror reads only, in this order. The first failure returns `{ isValid: false, invalidReason }`, with the reason in brackets.

1. **Payload shape** (`malformed`). `payment.payload` is `{ scheduleId, createTxId }`. `scheduleId` matches `/^0\.0\.\d+$/`, and `createTxId` matches `/^0\.0\.\d+@\d+\.\d+$/`.
2. **Not claimed yet** (`replay`). `seen.has(scheduleId)` must be false.
3. **On the mirror** (`schedule_not_found`). `getSchedule(scheduleId, mirror)`, polled every `pollMs` up to `waitScheduleMs`.
4. **Status.**
   - `deleted` gives `schedule_deleted`.
   - `executedTimestamp` set gives `schedule_executed`.
   - Expired gives `schedule_expired`. Use `scheduleStatus`'s rule, or `secondsOf(expirationTime) <= now()`.
   - `waitForExpiry === true` gives `wait_for_expiry`.
5. **Hold window** (`hold_window`). `remaining = secondsOf(expirationTime) - now()` must satisfy `req.maxTimeoutSeconds + 60 <= remaining <= 3600`.
6. **Body and terms.**
   - `inspectScheduled(schedule.transactionBody)`.
   - Then `checkScheduledTransfer(inspected, { asset: req.asset, amount: BigInt(req.amount), payTo: req.payTo, offerHash: String(req.extra?.offerHash), payer: schedule.payer })`.
   - A throw or a refusal gives `mismatch: <its message>`.
7. **The payee holds** (`payee_does_not_hold`). `mirrorFetch(<base>/api/v1/accounts/<req.payTo>, mirror)` must answer 200 with `receiver_sig_required === true`.
8. **The buyer signed** (`unsupported_payer_key` or `payer_not_signed`).
   - The account read for `schedule.payer` must have `key._type` of `ECDSA_SECP256K1` or `ED25519`.
   - At least one entry of `schedule.signatures` must be a record with a string `public_key_prefix`. Base64-decoded, it must be at least 4 bytes and a byte-prefix of `Buffer.from(key.key, "hex")`.

On success, return `{ isValid: true, payer: schedule.payer }`.

**`settle(payment, req)`.**

- `seen.claim(scheduleId)`. If it is false, return `{ success: false, errorReason: "replay", transaction: "", network }`.
- Store the hold under `heldJobId(createTxId)` as `{ scheduleId, createTxId, payTo: req.payTo, asset: req.asset, amount: req.amount, payer }`. `payer` is from `verify`, or a fresh `getSchedule`.
- Return `{ success: true, payer, transaction: createTxId, network: HEDERA_TESTNET }`.
- Submit nothing.

**`escrow.release(jobId, slipHash, sellerSig, countersign)`.**

1. **The hold.** If there is no hold for `jobId`, return failure `unknown_job`. If `countersign` is not a string, return failure `no_countersign`.
2. **The bytes** (`bad_countersign`). `Transaction.fromBytes(Buffer.from(countersign, "base64"))` must be a `ScheduleSignTransaction` with `scheduleId?.toString() === hold.scheduleId` and `transactionId?.accountId?.toString() === hold.payTo`. A throw also gives `bad_countersign`.
3. **Submit.** `submit(tx)`. A status other than `SUCCESS` or `SCHEDULE_ALREADY_EXECUTED` returns failure `submit_failed: <status>`.
4. **The execution.**
   - `waitForScheduledExecution(hold.createTxId, { ...mirror, timeoutMs: executionTimeoutMs })` must return a record with `result === "SUCCESS"`.
   - `netFor(record.tokens[hold.asset] ?? [], hold.payTo) === BigInt(hold.amount)`.
   - `netFor(record.tokens[hold.asset] ?? [], hold.payer) === -BigInt(hold.amount)`.
   - Otherwise return failure `execution_failed: <result>`. A timeout also gives `execution_failed: timeout`.
5. **Success.** Delete the hold, then return `{ success: true, payer: hold.payer, transaction: hold.createTxId, network }`.

Every failure is `{ success: false, errorReason, transaction: "", network }`, and every failure keeps the hold.

**`escrow.refund(jobId)` and `escrow.cancel(jobId, sellerSig)`.**

- No hold: failure `unknown_job`.
- `getSchedule` shows `executedTimestamp`: failure `executed`.
- Otherwise delete the hold and return `{ success: true, payer: hold.payer, transaction: hold.createTxId, network }`. Nothing moved.

**`escrow.status(jobId)`.**

| State | Status |
|---|---|
| No hold | `"none"` |
| The schedule executed | `"released"` |
| Deleted, or past its expiration | `"refunded"` |
| Otherwise | `"funded"` |

Do not define `failDelivery`, `bondOfPayee` or `tollBps`.

**2. `delivery.ts`.** `BuildOrderInput` gains `schedule?: { id: string; createTx: string }`. `buildOrder` sets `order.schedule` when it is present.

**3. `call.ts`.**

- **The order.** When `match.rail.declaration.id === "hedera-scheduled"`, pass `schedule: { id: String(payment.payload.scheduleId), createTx: String(payment.payload.createTxId) }` into `buildOrder`.
- **The release.** Call `escrow.release(jobId, slipHash, delivered.slip.sellerSig, delivered.countersign)`.
- **`failedDelivery`.** Give it the matched rail id. When that id is `"hedera-scheduled"` and there is no `gateMessage`, its message is exactly:

  > Not delivered. Nothing was charged: the scheduled payment was never countersigned, so it expires unsigned and no money moves.

  The other rails' messages are unchanged.

**4. `runners.ts`.** On a `result` frame whose `countersign` is a string, put it on the successful dispatch result as `countersign`. Any other value is ignored.

**5. `rails.ts`.**

- With `HEDERA_SCHEDULED_RAIL=1`, start `makers.hederaScheduled ?? (() => createHederaHeldRail())` through `startOptional`, like hedera.
- Add `RailMakers.hederaScheduled`.
- Add this doc line: `HEDERA_SCHEDULED_RAIL=1 -> rail "hedera-scheduled" (a held Hedera payment: the buyer's schedule executes only when the hub submits the seller's countersignature after a checked delivery; the hub holds no key)`.

## Tests (offline: inject `mirror.fetch` and `submit`; no network)

**`packages/rail/src/hedera/test/held.test.ts`.** Build schedule bodies the way `schedule.test.ts` and `fixtures.ts` do. Build the ScheduleSign bytes with:

```
new ScheduleSignTransaction().setScheduleId(...).setTransactionId(TransactionId.generate(payee)).setNodeAccountIds([AccountId.fromString("0.0.3")]).freeze()
```

then sign with a generated key.

- **`challenge`.**
  - The fields above.
  - It throws without `payTo["hedera-scheduled"]`.
  - `holdSeconds` is the deadline + 180.
- **`verify`.**
  - The happy path gives `{ isValid: true, payer }`.
  - One test per refusal, each giving its exact reason: `malformed`, `replay` (after a settle), `schedule_not_found` (with `waitScheduleMs: 0`), `schedule_deleted`, `schedule_executed`, `schedule_expired`, `wait_for_expiry`, `hold_window` (too short and too long), `mismatch` (wrong amount), `payee_does_not_hold`, `unsupported_payer_key`, `payer_not_signed`.
- **`settle`.**
  - It returns `transaction` equal to `createTxId` and calls `submit` zero times.
  - A second settle of the same schedule gives `replay`.
- **`release`.**
  - Success: the fake submit returns SUCCESS and the mirror's `?scheduled=true` record is SUCCESS with the exact +/- amounts.
  - `SCHEDULE_ALREADY_EXECUTED` counts as submitted.
  - `bad_countersign`, three ways: a different schedule id, a different payer account, a TransferTransaction's bytes.
  - `no_countersign`, `unknown_job`, `submit_failed: INVALID_SIGNATURE`, and `execution_failed: INSUFFICIENT_TOKEN_BALANCE`.
  - After each failure the hold is still there: a later correct release succeeds.
- **`refund` and `cancel`.** Success when the schedule is pending or expired; `executed` when it executed.
- **`status`.** Each row of the table.
- **`heldJobId`.** It equals `keccak256(toBytes(createTxId))`.

**`apps/hub/test/held.test.ts`.** Use `startHub`, `publishOk` and `call` from `support.ts`, and the runner from `runner-client.ts`.

- **The fake rail.** Define, in the test file, a fake rail with the held declaration (id `hedera-scheduled`, `kind: "escrow"`, scheme `countersign`, network `hedera:testnet`). Its `verify` and `settle` succeed, `settle.transaction` is a fixed `createTxId`, and its `escrow.release` records all four arguments.
- **A paid call.** An offer with `rails: ["hedera-scheduled"]` and `payTo: { "hedera-scheduled": "0.0.11338176" }`. The payment payload is `{ scheduleId: "0.0.500", createTxId }`, and the runner answers with `countersign: "c2lnbmVk"`.
  - The order the runner received has `schedule` equal to `{ id: "0.0.500", createTx: createTxId }`.
  - `release` received `"c2lnbmVk"` as its fourth argument.
  - The answer is 200, and the slip's `settlement.transaction` is the release's transaction.
- **The runner fails.** The answer is 502, its message is the new sentence, and `release` was never called.
- **The output fails the gate** (for example, the runner returns an output that breaks the offer's output schema). The answer is 502, and `release` was never called.
- **The router.** An offer with `rails: ["hedera", "hedera-scheduled"]`, with a direct fake `hedera` rail registered too. The 402's `accepts` lists `hedera-scheduled` before `hedera`.
- **`railsFromEnv`.** `HEDERA_SCHEDULED_RAIL=1` with a `hederaScheduled` maker gives rail id `hedera-scheduled`. Without the flag, the rail is absent.

Every existing test passes unedited, except `runner-client.ts` gaining the optional field.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run a script under `scripts/hedera/`.** **No network** in tests. **No keys:** never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies: viem, `@hiero-ledger/sdk` and `@hiero-ledger/proto` are already in `packages/rail`. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail apps/hub && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-12` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
