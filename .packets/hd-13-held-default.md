# hd-13-held-default: the seller countersigns only what it delivered, and the agent pays held by default

## Goal

Build decisions D9 and D10 of `/Users/thescoho/Developer/countersign-mumbai/hd/DESIGN-hedera-held-default.md` exactly. Read it first.

hd-12 (already on this branch) added:
- the `hedera-scheduled` rail;
- `JobOrder.schedule`;
- the `countersign` field on the runner's `result` frame;
- the hub submitting the seller's pre-signed ScheduleSign only after a checked delivery.

This packet makes both ends use it:
- **the seller's runner** signs, without submitting, a ScheduleSign for a held order, only after its output passed the offer's schema and its slip is signed;
- **the buyer agent** pays with a held schedule whenever the hub offers one.

Tracked by issue #41.

## Lease

- `packages/rail/src/hedera/schedule.ts`: add `prepareCountersign` and a shared internal check function. `countersignSchedule` keeps its signature and behaviour.
- `packages/runner/src/daemon.ts`: `RunnerConfig.countersign` and its use in the job handler.
- `packages/buyer/src/hedera/agent.ts`: the held path in `buy()`, the `preferHeld` option, `hold` on the outcomes, and a shared helper extracted from `schedule()`.
- `scripts/hedera/mcp-seller.ts`: the offer's rails, payTo and output schema, and the countersigner.
- `packages/rail/src/hedera/mirror.ts`: `getTransaction`'s record choice only (cs-w1's should-fix on 787ecd9).
- `packages/rail/src/hedera/held.ts`: one more check in `verify` only (section 6).
- `scripts/hedera/agent-run.ts`: `--exact`, `--prove-undelivered`, and the held evidence.
- New tests:
  - `packages/rail/src/hedera/test/prepare-countersign.test.ts`
  - `packages/runner/test/countersign.test.ts`
  - `packages/buyer/src/hedera/test/held.test.ts`
  - `packages/rail/src/hedera/test/get-transaction.test.ts`
  - `packages/rail/src/hedera/test/held-create.test.ts`
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-13-held-default.md`

## The decided design

### 1. `schedule.ts`

**The shared check.** Move every check that `countersignSchedule` runs before it submits into one internal function: `checkBeforeCountersign(scheduleId, expected, opts) → Promise<MirrorSchedule>`. That is:
- `waitForMirrorSchedule`;
- the status must be pending;
- the `wait_for_expiry` refusal;
- `payer_mismatch`;
- `inspectScheduled`;
- `checkScheduledTransfer`.

`countersignSchedule` calls it, then submits exactly as today.

**`prepareCountersign`.** Add:

```ts
export async function prepareCountersign(
  sellerAccountId: string, sellerKey: PrivateKey, scheduleId: string,
  expected: ExpectedScheduledTransfer, opts: CountersignOptions & { nodeAccountIds?: string[] } = {},
): Promise<{ bytes: string; transactionId: string }>
```

1. Run `checkBeforeCountersign`.
2. Build `new ScheduleSignTransaction().setScheduleId(ScheduleId.fromString(scheduleId)).setTransactionId(TransactionId.generate(AccountId.fromString(sellerAccountId)))`.
3. Freeze it:
   - with `opts.nodeAccountIds`, the way `packages/buyer/src/hedera/signer.ts` does (`setNodeAccountIds` then `freeze()`);
   - otherwise `freezeWith(Client.forTestnet())`, closing that client afterwards.
4. `await tx.sign(sellerKey)`.
5. Return `{ bytes: base64(tx.toBytes()), transactionId: tx.transactionId!.toString() }`.

**It never submits.**

### 2. `daemon.ts`

`RunnerConfig` gains:

```ts
/** Signs, never submits, the seller's release of a held payment (rail "hedera-scheduled").
 *  Called only after the output passed the offer's schema and the slip is signed. */
countersign?: (order: JobOrder) => Promise<string>;
```

In the job handler, inside the existing `try`, after `sellerSig`:

```ts
let countersign: string | undefined;
if (order.rail === "hedera-scheduled") {
  if (!cfg.countersign || !order.schedule) throw new Error("Refused. This runner cannot countersign a held Hedera payment.");
  countersign = await cfg.countersign(order);
}
send(target, { t: "result", jobId: order.jobId, output, slip: { body, hash, sellerSig }, ...(countersign === undefined ? {} : { countersign }) });
```

The existing `catch` already sends `fail`, so a refusal or a throw signs nothing. For any other rail, nothing changes.

### 3. `agent.ts`

**Options and outcomes.**
- `HederaAgentOptions` gains `preferHeld?: boolean`, default `true`.
- The `paid` and `failed` members of `BuyOutcome` gain `hold?: ScheduleHold`.

**Choosing the held path.** In `buy()`, right after the 402's `required` is parsed and before the exact option is chosen:

```ts
const held = required.accepts.find(
  (a) => a.network === HEDERA_TESTNET && a.scheme === "countersign" && a.extra?.name === "hedera-scheduled");
if (held && opts.preferHeld !== false) return buyHeld(listing, held, url, body);
```

**The shared helper.** Extract the part of `schedule()` that runs after its own checks into one internal helper, used by both `schedule()` and `buyHeld`:
1. reserve;
2. `createSchedule`;
3. the error handling as it is today;
4. `settleReservation`;
5. `log("schedule", …)`;
6. build the `ScheduleHold`.

`schedule()` keeps its behaviour and its outputs.

**`buyHeld(listing, held, url, body)`.**

1. **Check the challenge.** All of these must hold:
   - `held.extra.offerHash === listing.offerHash`
   - `held.amount === listing.offer.price`
   - `held.payTo === listing.offer.payTo?.["hedera-scheduled"]`
   - `typeof held.extra.holdSeconds === "number"`, with `60 <= holdSeconds <= 3600`

   Otherwise return the same `challenge-mismatch` refusal as the exact path.
2. **Need a client.** If `opts.logClient` is missing, throw `Error("hedera agent needs logClient to pay a held offer")`.
3. **The envelope.** Check it exactly as the exact path does (`needsHuman`, `checkEnvelope` with pending spend, refusal logged).
4. **Create and log.** Run the shared helper with:
   - payee `held.payTo`, asset `held.asset`, amount `held.amount`;
   - subject `{ offerHash: listing.offerHash, seller: listing.offer.seller }`;
   - `expiresInSeconds: held.extra.holdSeconds`;
   - client `opts.logClient`.
5. **Pay.** POST to `url` with `body` and the header `[PAYMENT_SIGNATURE_HEADER]: toBase64Json({ x402Version: 2, accepted: held, payload: { scheduleId, createTxId }, resource: { url } })`. A thrown fetch counts as status `0`, with the error's message.
6. **On 200.**
   - Parse the `CallResult`, and take the settlement from `PAYMENT-RESPONSE` as the exact path does.
   - If `toSdkTxId(settlement.transaction) !== toSdkTxId(createTxId)`, throw `Error(\`hub reported settlement ${settlement.transaction}, but this agent's schedule was created by ${createTxId}\`)`.
   - Return `{ kind: "paid", output, slip, settlement, transactionId: createTxId, logSequence, hold }`.
7. **Otherwise.**
   - Read `getSchedule(scheduleId, opts.mirror)`, catching an error as `null`.
   - `charged` is `true` only when `executedTimestamp` is set.
   - Return `{ kind: "failed", status, message, charged, transactionId: createTxId, logSequence, hold }`.

`buyHeld` itself never calls `release` or `settleReservation`, and logs no `spend` entry. The `schedule` entry is the record, and `releaseExpired(hold)` is the only way the amount comes back.

### 4. `mcp-seller.ts`

**The keys.** `HD_SELLER_SIGN_ID = need(env, "HD_SELLER_SIGN_ID")` and `HD_SELLER_SIGN_KEY = key(env, "HD_SELLER_SIGN_KEY")`.

**The offer.**
- `rails: ["hedera-scheduled", "hedera"]` and `payTo: { "hedera-scheduled": HD_SELLER_SIGN_ID, hedera: SELLER_ACCOUNT_ID }`.
- Append to the summary: " On Hedera it is paid as a held schedule by default: nothing moves until the seller countersigns after delivery."

**The countersigner.** `startRunner` gains:

```ts
countersign: async (order) => {
  if (order.rail !== "hedera-scheduled" || !order.schedule) throw new Error("Refused. Not a held Hedera order.");
  if (order.payTo !== HD_SELLER_SIGN_ID) throw new Error("Refused. The held payment is not to this seller's account.");
  const { bytes } = await prepareCountersign(HD_SELLER_SIGN_ID, HD_SELLER_SIGN_KEY, order.schedule.id,
    { asset: order.asset, amount: BigInt(order.amount), payTo: order.payTo, offerHash: order.offerHash, payer: order.buyer });
  return bytes;
}
```

**The output schema.** Set the offer's `output` to:

```ts
{ type: "object", required: ["tool", "server", "inputHash", "result"],
  properties: { result: { type: "object", required: ["bytes"] } } }
```

The kit reports a failure in band: a normal result whose JSON is `{ raw: { status: "ERROR", … }, humanMessage }`, with no `bytes`. That checked live at 14:2xZ with the account id `"not-an-account"`. With this schema, such a result fails the runner's own output check before anything is signed, so it is never delivered or countersigned.

The offer changes, so a new offer hash is published and printed as today.

### 5. `mirror.ts`: `getTransaction` picks the SUCCESS record

The mirror lists every record that carries a transaction id. A duplicate submission can list `DUPLICATE_TRANSACTION` ahead of the real `SUCCESS`.

- **The record.** `getTransaction` returns `d.transactions.find((t) => t.result === "SUCCESS") ?? d.transactions[0]`, normalized as today. That is the first SUCCESS record if there is one, otherwise the first record.
- **Nothing else changes.**
- **Test, in `get-transaction.test.ts`.** A fake mirror lists `[DUPLICATE_TRANSACTION, SUCCESS]` for one id, and the result is the SUCCESS record. A list of only failures returns the first.

### 6. `held.ts`: `createTxId` must be the schedule's own create

Insert this check in `verify` right after the payload-shape check and the replay check.

- **The read.** `mirrorFetch(<base>/api/v1/transactions/<toMirrorTxId(createTxId)>, mirror)`.
- **The condition.** It must answer 200 with a `transactions` array that has a record where all of these hold:
  - `name === "SCHEDULECREATE"`;
  - `entity_id === scheduleId`;
  - `result === "SUCCESS"`.
- **On failure.** Otherwise `{ isValid: false, invalidReason: "create_mismatch" }`. Poll it like `findSchedule` does (`waitScheduleMs`, `pollMs`), because the mirror trails consensus.
- **Live shape, checked at 14:4xZ.** `/api/v1/transactions/0.0.11337064-1793972401-951725298` gives `[{ name: "SCHEDULECREATE", entity_id: "0.0.11339869", result: "SUCCESS", scheduled: false }]`.
- **Tests, in `held-create.test.ts`.**
  - A matching create passes.
  - A create of another schedule gives `create_mismatch`.
  - A CRYPTOTRANSFER record gives `create_mismatch`.
  - Copy `held.test.ts`'s fixtures, and keep `held.test.ts`'s happy path passing by teaching its fake mirror the create record. That is the one edit to `held.test.ts` this packet may make.

### 7. `agent-run.ts`

**`--exact`.** Sets `preferHeld: false`.

**Held evidence.** When the outcome has `hold`, add these entries:

| Label | Value | Url |
|---|---|---|
| `schedule` | the schedule id | `https://hashscan.io/testnet/schedule/<id>` |
| `schedule create` | `createTxId` | `hashscanTx(createTxId)` |
| `hold log` | `#<logSequence>` | the topic link |

**On `paid` with a hold.** Also add `execution`: `waitForScheduledExecution(createTxId, { timeoutMs: 60_000 })` reported as `"<result> at <consensusTimestamp>, +<amount> to <payTo>"`, with the credit from `netFor`.

**`--prove-undelivered`.** For the failure proof:
1. Read the agent's USDC balance (`tokenBalance`) before buying.
2. Expect `kind: "failed"` with `charged: false` and a `hold`.
3. Wait until `hold.expiresAt + RELEASE_MARGIN_SECONDS`.
4. Call `agent.releaseExpired(hold)` every 3 s until it is not `"pending"`, for at most 60 s more.
5. Read the schedule (expect no `executedTimestamp`) and the balance after.
6. Add evidence: `hub answer` (status and message), `executed none`, `release <outcome>`, `balance <before> -> <after> USDC`, and the `expired` entry's sequence from `readEntries`.

`ok` is true only when all of these hold:
- the status is not 200 and `charged` is false;
- the release is `"released"`;
- nothing executed;
- the balance is unchanged.

**Other runs.** Without the flag, `ok` keeps today's meaning (a paid call). The JSON shape is unchanged.

## Tests (offline; no network, no keys)

**`packages/rail/src/hedera/test/prepare-countersign.test.ts`.** Use a fake mirror built like the one in `schedule.test.ts` and `fixtures.ts`.
- **Happy path.** It returns base64 that `Transaction.fromBytes` decodes to a `ScheduleSignTransaction`. The decoded transaction has:
  - the schedule id;
  - a transaction id whose account is the seller;
  - at least one signature.

  Use `nodeAccountIds: ["0.0.3"]`.
- **Refusals.** Each check refuses in prepare as it does in countersign: a non-pending schedule, `wait_for_expiry`, `payer_mismatch`, an amount `mismatch`.
- **Unchanged.** `countersignSchedule`'s existing tests still pass unedited.

**`packages/runner/test/countersign.test.ts`.** Use `daemon.test.ts`'s fixtures.
- **Held order.** For an order on `hedera-scheduled` with `schedule`:
  - the countersigner is called once, with the order, after the slip is signed;
  - the `result` frame carries its return value as `countersign`.
- **Countersigner throws.** The runner sends `fail`, not a `result`.
- **No countersigner configured.** The runner sends `fail` with "cannot countersign a held Hedera payment".
- **Another rail.** For an order on `hedera`, the countersigner is not called, and the frame has no `countersign`.

**`packages/buyer/src/hedera/test/held.test.ts`.** Build the agent as `agent.test.ts` does. Use a fake hub in the test file whose 402 offers a held entry (`scheme: "countersign"`, `extra: { name: "hedera-scheduled", offerHash, holdSeconds: 300 }`) before an exact entry. Inject `createSchedule` (a fake returning a `ScheduledPayment`), `appendLog`, `logClient` (any object cast to `Client`) and a fake mirror for `getSchedule`.
- **Paid.** The held path is taken: `createSchedule` is called, and the payment payload is `{ scheduleId, createTxId }`.
  - The hub answers 200 with the settlement equal to `createTxId`.
  - The outcome is `paid` with `hold`.
  - There is exactly one `schedule` log entry and no `spend` entry, and `spent` includes the amount.
- **`preferHeld: false`.** The exact path is taken.
- **Challenge mismatch.** A wrong `payTo`, or `holdSeconds: 10`, gives `challenge-mismatch`, and `createSchedule` is not called.
- **Undelivered.** The hub answers 502 and the mirror shows the schedule pending.
  - The outcome is `failed`, with `charged: false` and `hold`, and `spent` still includes the amount.
  - Then, with a clock past `expiresAt + RELEASE_MARGIN_SECONDS` and the mirror showing it expired, `releaseExpired(hold)` gives `"released"` and `spent` drops by the amount.
- **Executed after a 502.** The hub answers 502 but the mirror shows the schedule executed: `charged: true`.
- **Wrong settlement.** A settlement transaction other than `createTxId` makes `buy` reject.

Every existing test passes unedited.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **Never run a script under `scripts/hedera/`.** They spend real testnet funds; cs-hd runs them live. **No network** in tests. **No keys:** never read an env file, a config directory or the keychain.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. The runner package must not gain a Hedera dependency: the countersigner is injected. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera packages/runner packages/buyer && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-13` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
