# hd-08b-schedule-fixes: the seller reads every byte it signs, and a schedule counts against the cap from the moment it exists

## Goal

This is the one corrective packet for hd-08 (the Hedera scheduled checkout, issue #41). Review of `56e5283` found one blocker and three should-fixes. Fix all four, and add `--json` evidence to the live script.

- **B11 (blocker).** The seller approves a schedule after reading its body with a hand-written protobuf reader that takes the first transfer member and ignores everything else. Protobuf lets a body carry two members of its `data` oneof, or the same member twice, and the network executes what it parses, not what the reader saw. A body holding the benign USDC transfer followed by a second member passes the check and then executes the second member once the seller's key signs. The failing test is `packages/rail/src/hedera/test/w1-schedule.test.ts`, already committed on this branch.
- **Should-fix 1.** `createScheduledPayment` signs a transfer the seller can execute at any time until expiry, but nothing reserves it against the envelope, and it is logged only after it executes. Two schedules created back to back both pass the cap.
- **Should-fix 2.** `AccountAmount.is_approval` (an allowance debit) is ignored. Refuse it explicitly.
- **Should-fix 3.** `scripts/hedera/setup.ts` seeds the seller-sign account with 0.3 HBAR, but its USDC association costs about 0.72 HBAR, so setup fails with `INSUFFICIENT_PAYER_BALANCE`.

## Lease

You may create or change only these paths:

- `packages/rail/src/hedera/schedule.ts`, `packages/rail/src/hedera/mirror.ts` (only if you need a new mirror field), `packages/rail/src/hedera/test/schedule.test.ts`
- `packages/rail/package.json`: one new dependency line, nothing else
- `packages/buyer/src/hedera/agent.ts`, `packages/buyer/src/hedera/schedule.ts`, `packages/buyer/src/hedera/spendlog.ts`
- `packages/buyer/src/hedera/test/agent.test.ts`, `schedule.test.ts`, `spendlog.test.ts`: add tests; never change or delete an existing assertion
- `scripts/hedera/schedule.ts`, `scripts/hedera/setup.ts`, `scripts/hedera/audit.ts`
- Report: `$M/reports/hd-08b-schedule-fixes.md`

Never edit `packages/rail/src/hedera/test/w1-schedule.test.ts`, `packages/rail/src/hedera/test/w1-attacks.test.ts` or any other `w1-*` test. Do not edit `docs/`; the lane updates the docs after review.

## Context

Read first:

- the review: `$M/reports/review-56e5283.md`;
- `packages/rail/src/hedera/schedule.ts`: `inspectScheduled`, `checkScheduledTransfer`, `countersignSchedule`, `scheduleStatus`;
- `packages/buyer/src/hedera/agent.ts`: how `buy` checks the envelope, then calls `reserve` with no `await` in between, and how `log`, `release` and `settleReservation` work;
- `packages/buyer/src/hedera/spendlog.ts`: `SpendEntry`, `parseEntry`, `reconcile`;
- `scripts/hedera/schedule.ts` and `scripts/hedera/agent-run.ts` (its `--json` pattern).

Facts you need:

- `@hiero-ledger/sdk` 2.90.1 depends on `@hiero-ledger/proto` **2.32.0**, which exports `proto.SchedulableTransactionBody` with protobufjs `decode` and `encode`. Use exactly that version, so the bytes match what the SDK itself encodes.
- The mirror node returns a schedule's body as base64 `SchedulableTransactionBody` bytes in `transaction_body`. A real body from testnet has exactly three top-level fields: 1 `transactionFee`, 2 `memo`, 9 `cryptoTransfer`. Inside `cryptoTransfer`: field 1 `transfers` (an empty HBAR list, length 0) and field 2 `tokenTransfers`.
- protobufjs keeps only the last occurrence of a repeated singular field and drops unknown fields when it decodes. The network's parser behaves differently: it merges repeated message fields and keeps unknown ones. So decoding alone does not prove the reader saw what the network will execute. An exact re-encode does.

## Required

### 1. B11: decode strictly (`packages/rail/src/hedera/schedule.ts`)

1. Add `"@hiero-ledger/proto": "2.32.0"` to `dependencies` in `packages/rail/package.json`, then run `bun install`. Do not stage `bun.lock`.
2. Rewrite `inspectScheduled(bodyBase64)`:
   - decode the bytes with `proto.SchedulableTransactionBody.decode`;
   - re-encode with `proto.SchedulableTransactionBody.encode(decoded).finish()`. The result must equal the input byte for byte; otherwise throw `InspectError("scheduled body is not in canonical form")`. Put the reason in a short comment: only an exact round trip proves there were no repeated members and no unknown fields;
   - the decoded body may set only `transactionFee`, `memo` and `cryptoTransfer`, and `decoded.data` must be `"cryptoTransfer"`. Any other field set means throw;
   - inside `cryptoTransfer`, every `AccountAmount` with `isApproval` true means throw: "allowance transfers are refused" (should-fix 2);
   - return the same `InspectedTransfer` shape as today, so `checkScheduledTransfer` keeps its rules unchanged.
3. Accept only the `SchedulableTransactionBody` bytes the mirror returns. Delete the code that also accepted a full transaction body or a transaction list, and the hand-written reader (`readFields`, `decodeAccount`, `decodeToken`, `decodeAccountAmounts`, `decodeTransferList`, `decodeTokenTransfers`, `transferBody`, `zigzag`) once nothing uses it. Existing tests that built fixtures in another shape must extract the `SchedulableTransactionBody` the way `benignBody()` in `w1-schedule.test.ts` does.
4. `countersignSchedule` must read the body from the mirror node only.
   - Remove the `ScheduleInfoQuery` fallback: the SDK hands back an already-parsed transaction, so the raw bytes cannot be checked.
   - When the mirror does not show the schedule yet, poll `getSchedule` every 1.5 s for up to 20 s (both configurable through options for tests). If it never appears, throw `ScheduleRefusedError("not_found", "Refused. The schedule is not on the mirror node yet, so its body cannot be checked.")` without signing.
   - Delete `inspectScheduledTransaction` if nothing else uses it.

### 2. Setup funding (`scripts/hedera/setup.ts`, should-fix 3)

The operator pays every USDC association. Freeze each `TokenAssociateTransaction` with the operator's client `op` and sign it with the account's own key, so an account needs no HBAR for its own association. Keep the 0.3 HBAR seed for the seller-sign account's `ScheduleSign` fees. Update the comment that explains the seed.

### 3. A schedule counts against the cap from the moment it exists (should-fix 1)

**Spend log (`spendlog.ts`).**

- `SpendEntry.kind` becomes `"spend" | "refused" | "schedule" | "expired"`, and `SpendEntry` gains an optional `expiresAt?: number` (unix seconds).
- A `schedule` entry is written right after a ScheduleCreate succeeds:
  - `tx` is the create transaction id, `schedule` the schedule id and `expiresAt` the schedule's expiration;
  - `offerHash`, `seller`, `payTo`, `asset` and `amount` are as for a spend;
  - `total` is the envelope total including this amount.
- An `expired` entry is written when the mirror shows a logged schedule expired or deleted without executing. It carries the same `tx`, `schedule`, `offerHash`, `seller`, `payTo`, `asset` and `amount` as its `schedule` entry, and `total` is the envelope total after the release.
- `parseEntry` accepts both kinds:
  - both require string `tx` and `schedule`;
  - `schedule` also requires a finite numeric `expiresAt`.
- The existing forms stay valid unchanged, including a `spend` that carries a `schedule` id (the live topic already holds one, sequence 16).
- `reconcile`:
  - **`schedule` entries.** Look up the execution with `getTransaction(e.tx, { scheduled: true })`.
    - If found, apply exactly the checks a spend gets and file it as matched or unbacked. Add both the create id and the executed id to the logged set, so the execution never shows as unlogged.
    - If there is no execution, read the schedule's status (`scheduleStatus` from `@countersign/rail/hedera`). `pending` goes to a new `pending` list; `expired` or `deleted` goes to a new `released` list. Neither is unbacked.
  - **`expired` entries.** Check that the schedule did not execute and is expired or deleted.
    - If it executed: unbacked, with why "logged as expired, but the schedule executed".
    - If it is still pending: unbacked, with why "logged as expired, but the schedule is still pending".
  - `Reconciliation` gains `pending: LoggedEntry[]` and `released: LoggedEntry[]`. The existing fields keep their meaning.

**Envelope (`agent.ts`).** Change `spentFromLog` so that:

- `spend` and `schedule` entries add;
- an `expired` entry subtracts the amount of the earlier `schedule` entry with the same schedule id. It does so once, and only when that `schedule` entry exists earlier in the log;
- a `spend` whose `schedule` id matches an earlier `schedule` entry adds nothing, because it was already counted.

**Agent (`agent.ts`).** `createHederaAgent` gains two methods and one option.

- **Option** `createSchedule?: typeof createScheduledPayment`, a test seam. When it is omitted, use `createScheduledPayment` from `./schedule.ts`.
- **`schedule(target: { offer: Offer; offerHash: string }, opts: { client: Client; expiresInSeconds: number })`:**
  1. Require `target.offer.rails` to include `"hedera"` and `target.offer.payTo?.hedera` to be an account id. The amount is `target.offer.price` and the asset is `USDC_TESTNET`.
  2. Make the same envelope decision `buy` makes, with `needsHuman` and `checkEnvelope` against `spendIncludingPending()`. On refusal, append a `refused` entry and return `{ kind: "refused", reason, message, logSequence }`.
  3. Reserve with no `await` between the decision and the reservation, exactly as `buy` does.
  4. Call `createSchedule(opts.client, opts.payer, {...})`.
     - If it throws, keep the reservation held and rethrow. The create may have reached consensus, so the hold stays for the life of the agent. Say so in a comment.
  5. On success, call `settleReservation` and append the `schedule` entry. Return `{ kind: "scheduled", scheduleId, createTxId, expiresAt, logSequence, hold }`, where `hold` carries `{ scheduleId, createTxId, offerHash, seller, payTo, asset, amount }`.
- **`releaseExpired(hold)`:**
  1. Read `scheduleStatus(hold.scheduleId, { ...opts.mirror, now })`.
  2. `pending` returns `"pending"` and `executed` returns `"executed"`; neither changes anything.
  3. `expired` or `deleted` subtracts the amount from `spent`, appends the `expired` entry and returns `"released"`.
  4. A second call for the same schedule returns `"released"` again and appends nothing, so track released ids.
- `buy` and every existing behaviour stay exactly as they are. Every existing agent test passes unedited.

### 4. The live script (`scripts/hedera/schedule.ts`)

- Build the agent with `createHederaAgent`. Use the hub URL from the environment if the script already reads one; otherwise pass `"http://127.0.0.1:0"`, because `schedule` never calls the hub. Pass `spent: spentFromLog(prior)`, the envelope the script builds today, `logClient: agentClient` and the topic.
- **Main flow:**
  - `agent.schedule(...)`, then print the create transaction, the schedule and the `schedule` entry's HCS sequence with links;
  - the seller checks and countersigns as today, then the run waits for the execution and prints it;
  - do **not** append a separate spend entry after execution: the `schedule` entry already covers it;
  - reconcile the run's window. A good run has matched 1, unbacked 0 and unlogged 0.
- **`--expiry-demo`:**
  - `agent.schedule(...)` with 60 s, then wait past the expiry;
  - `agent.releaseExpired(hold)`, then print the `expired` entry's sequence;
  - show `expired`, no `executed_timestamp`, the agent's USDC balance unchanged, and "Expired. Nothing moved.";
  - reconcile the window: released 1, unbacked 0.
- **`--json`** (both modes), following `agent-run.ts`:
  - human lines go to stderr;
  - at the end, print one JSON line `{"beat":"hedera-schedule","mode":"main"|"expiry","ok":...,"evidence":{...}}`;
  - the evidence holds `agent`, `offer` (title, hash, price), `create` (tx, url), `schedule` (id, url, expiresAt), `sign` (tx, url; main only), `executed` (consensus time and the seller's credit; main only), `log` (an array of `{sequence, kind, url}`), `balance` (before and after; expiry only) and `audit` (the counts of matched, unbacked, unlogged, pending and released).
- `scripts/hedera/audit.ts`: print the `pending` and `released` counts beside the existing ones, and add them to its `--json` output if it has one.

## Tests (offline; no network)

1. **Rail** (`packages/rail/src/hedera/test/schedule.test.ts`):
   - `w1-schedule.test.ts` passes unedited: the benign body is accepted and both crafted bodies are refused;
   - also refused:
     - an unknown field appended inside `cryptoTransfer`;
     - an `AccountAmount` with `isApproval` true;
     - a second `tokenTransfers` entry;
     - a non-empty HBAR `transfers` list;
     - any other top-level field set (for example field 3);
   - `countersignSchedule` with a mirror that never returns the schedule throws `not_found` and never signs. Pass short poll timings.
2. **Buyer**:
   - `spentFromLog`:
     - `schedule` adds;
     - `expired` subtracts once;
     - a duplicate `expired` subtracts nothing;
     - a legacy `spend` with `schedule` still counts;
     - a `spend` matching an earlier `schedule` entry does not double count.
   - `agent.schedule` with an injected `createSchedule`:
     - the second of two back-to-back schedules is refused when together they exceed the cap, and that refusal is logged;
     - a throwing create keeps the hold;
     - a success logs exactly one `schedule` entry with `tx`, `schedule` and `expiresAt`.
   - `releaseExpired`:
     - executed logs nothing;
     - expired logs one `expired` entry and lowers `spent`;
     - a second call logs nothing.
   - `reconcile`:
     - an executed `schedule` entry is matched;
     - a pending one is pending;
     - an expired one with its `expired` entry is released;
     - an `expired` entry whose schedule executed is unbacked.
3. Every existing test passes, the `w1-*` tests included.

## Constraints

- **No browser of any kind on this machine:** no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No live runs.** Do not run `keygen`, `setup`, `schedule`, `audit`, `beat` or any script that touches the network or the key file. The lane runs them live after review.
- **Keys.** Never read or print a key, and never open an env file.
- **Tests.** No network in tests. TypeScript strict, no `any`.
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. The x402 `buy` path does not change.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail/src/hedera packages/buyer/src/hedera && bun test
```

Every command passes with no skipped tests apart from those already skipped on this branch. Commit on `cs/hd-08b` with short present-tense messages ending `refs #41`, and no trailers. Write the report, including the full test counts. Do not push, merge or deploy.

## Stop conditions

- The exact re-encode rejects the benign SDK body, meaning the SDK's bytes and `@hiero-ledger/proto`'s differ: stop and report the first differing byte offset and both field lists.
- Part 3 has blocked you for more than 20 minutes: commit parts 1 and 2 with their tests (they do not depend on part 3), then write the report saying what remains.
- A change outside the lease looks necessary: stop and explain in the report.
