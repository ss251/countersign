# hd-08-schedule: Hedera scheduled checkout, where both parties' keys land on chain

## Goal

A second Hedera checkout built on scheduled transactions. Tracked by issue #41.

1. **Create.** The buyer's agent submits a `ScheduleCreateTransaction` wrapping an HTS USDC transfer (`0.0.429274`): agent `-amount`, seller `+amount`. The inner transfer's memo is the offer memo `cs1:<offer hash>` (use `offerMemo`). The schedule memo names the offer too. The agent pays and signs the create, and that signature counts toward the scheduled transfer.
2. **Countersign.** The seller countersigns with `ScheduleSignTransaction`. The seller account for this flow requires a receiver signature (`receiverSignatureRequired = true`), so the transfer cannot run without it, and it executes the moment the second key lands (`waitForExpiry = false`).
3. **Honest expiry.**
   - The schedule has an explicit `expirationTime` and no admin key, so nobody can delete it.
   - If the seller never signs, it expires and nothing moves; no refund transaction is needed because the money never left.
4. **Check before signing.** Before signing, the seller checks what it is signing: the scheduled body must be exactly that transfer, to itself, of the offer's amount, with the offer memo.
5. **Logged and reconciled.** The executed transfer is appended to the agent's HCS spend log, and the audit reconciles scheduled executions like any other spend.

## Lease

- Create `packages/rail/src/hedera/schedule.ts`, which holds the seller's check-and-countersign and the mirror reads for schedules. Add an export line to `packages/rail/src/hedera/index.ts`.
- Create `packages/buyer/src/hedera/schedule.ts`: the buyer's create, gated by the envelope.
- `packages/buyer/src/hedera/spendlog.ts`, for scheduled spends:
  - `SpendEntry` gains optional `schedule` (the schedule id);
  - `parseEntry` accepts it;
  - `reconcile` reads such entries' execution with `?scheduled=true`.
  Add a matching option to `getTransaction` in `packages/rail/src/hedera/mirror.ts`.
- Tests: `packages/rail/src/hedera/test/schedule.test.ts` and `packages/buyer/src/hedera/test/schedule.test.ts`.
- `scripts/hedera/keygen.ts` and `scripts/hedera/setup.ts`:
  - a new role `SELLER_SIGN` (`HD_SELLER_SIGN_KEY`, `_EVM`, `_ID`), created from the operator with `setReceiverSignatureRequired(true)`;
  - a small HBAR seed, about 0.3 HBAR, enough for its ScheduleSign fees and its USDC association.
- `scripts/hedera/schedule.ts`: the live flow (below).
- `docs/hedera.md`: one new section, "Scheduled checkout".
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-08-schedule.md`.

## Context

Read first:

- **SDK classes:** `@hiero-ledger/sdk` `ScheduleCreateTransaction` (`setScheduledTransaction`, `setScheduleMemo`, `setExpirationTime`, `setWaitForExpiry`, `setPayerAccountId`; no `setAdminKey`), `ScheduleSignTransaction` (`setScheduleId`), `ScheduleInfoQuery`, and `AccountCreateTransaction.setReceiverSignatureRequired`.
- **Mirror node:**
  - `GET /api/v1/schedules/{id}` returns `{schedule_id, creator_account_id, payer_account_id, memo, executed_timestamp, expiration_time, deleted, wait_for_expiry, transaction_body (base64), signatures[]}`.
  - The executed transfer is `GET /api/v1/transactions/{scheduleCreateTxId}?scheduled=true`.
- **Existing hedera code:** `packages/rail/src/hedera/{inspect,memo,mirror,txid,rail}.ts`, `packages/buyer/src/hedera/{signer,agent,spendlog}.ts`, `scripts/hedera/{env,setup,agent-run}.ts`, `docs/hedera.md`.

## Required

1. **Rail side (`packages/rail/src/hedera/schedule.ts`):**
   - `inspectScheduled(bodyBase64)` decodes a schedule's transaction body into the same shape `decodeTransfer` returns.
   - `checkScheduledTransfer(inspected, {asset, amount, payTo, offerHash, payer})` applies the same strict rules as `checkTransfer`: one debit, one credit, one token, exact amount, the offer memo, nothing else.
   - `countersignSchedule(sellerClient, scheduleId, expected)`:
     1. read the schedule from the mirror node, or `ScheduleInfoQuery`;
     2. refuse if it is deleted, executed, expired, or fails `checkScheduledTransfer`;
     3. otherwise submit `ScheduleSign` and wait for the receipt;
     4. return the sign transaction id.
   - `waitForScheduledExecution(createTxId)` returns the executed transfer record, or a timeout.
   - `scheduleStatus(id)` returns `"pending" | "executed" | "expired" | "deleted"`, from the mirror fields and the clock.
2. **Buyer side (`packages/buyer/src/hedera/schedule.ts`):**
   - `createScheduledPayment(agentClient, payer, {payTo, asset, amount, offerHash, expiresInSeconds})` builds the transfer with the offer memo, wraps it in `ScheduleCreateTransaction` with `expirationTime = now + expiresInSeconds`, `waitForExpiry = false` and no admin key, signs it with the agent key, submits it, and returns `{scheduleId, createTxId}`.
   - The caller runs the envelope (`checkEnvelope`) before calling it, exactly as `agent.ts` does.
3. **Spend log:** a scheduled spend is logged as `kind: "spend"` with `tx` = the create transaction id and `schedule` = the schedule id. `reconcile` checks it against the `?scheduled=true` execution record, with the same exact-amount and memo rules. Unscheduled entries behave exactly as they do today.
4. **`scripts/hedera/schedule.ts [--expiry-demo]`** runs live.
   - **Main flow:**
     1. Budget check, as in the beat.
     2. Envelope check.
     3. The agent creates the schedule. Print the create transaction id with its HashScan link, and the schedule id with `https://hashscan.io/testnet/schedule/<id>`.
     4. Print that the schedule is pending.
     5. The seller (`HD_SELLER_SIGN_*`) checks and countersigns. Print the sign transaction id with its HashScan link.
     6. Wait for the execution. Print "Executed when the second key landed" with the executed transfer's consensus time, and the seller's credit.
     7. Append the spend to HCS and print its sequence and links.
     8. Reconcile this run's window.
   - **`--expiry-demo`:**
     1. Create a schedule with `expiresInSeconds = 60` and never sign it.
     2. Print the schedule link.
     3. Wait past the expiry, polling the mirror node.
     4. Show `expired`, no `executed_timestamp`, and the agent's USDC balance unchanged.
     5. Print "Expired. Nothing moved."
5. **Tests (offline, built with the SDK and frozen with fixed node ids as the existing fixtures do):**
   - a correct scheduled body passes `checkScheduledTransfer`; a wrong amount, payee, token or memo, or an extra transfer, is refused;
   - `scheduleStatus` covers all four states from fake mirror records;
   - `reconcile` matches a scheduled entry against a fake `?scheduled=true` record and flags a wrong credit;
   - unscheduled reconcile tests stay green.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Do not run `keygen`, `setup`, `schedule` or any script that touches the network or the key file. The lane runs them live after review. Never read or print a key; use the `env.ts` helpers in scripts.
- No network in tests. Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.
- Keep the existing `x402` flow untouched. The scheduled flow is an addition, not a replacement.

## Acceptance

```
bun run typecheck && bun test packages/rail/src/hedera packages/buyer/src/hedera
```

Both must pass with no skipped tests. Commit on `cs/hd-08` with short present-tense messages ending `refs #41`, and no trailers.

## Stop conditions

- A change outside the lease looks necessary: stop and explain in the report.
- The SDK cannot express something above, for example signatures on the create not counting toward the scheduled transfer: stop and describe what you found.
