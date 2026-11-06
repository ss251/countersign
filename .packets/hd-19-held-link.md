# hd-19-held-link: a held settlement links the transfer that moved USDC, not the schedule's create

## Goal

STEER-2130 finding A5, the held half. Build H2 of `$M/hd/DESIGN-held-hub-key.md` exactly.

A held Hedera settlement's `transaction` is the schedule's create transaction id. That id binds the job (`jobId = keccak(createTxId)`), and the verifier and the agent check it. But the hub builds the settlement's explorer link from that same id, so the link opens a SCHEDULECREATE with no token movement.

After this change, the link opens the scheduled execution, the CRYPTOTRANSFER that moved the USDC, while `transaction` stays the create. The rails.ts doc line also stops overclaiming (A4's plain copy). Tracked by issue #41.

## Lease

- `packages/core/src/types.ts`: the `SettleResult` interface only.
- `packages/rail/src/hedera/held.ts`: the success return of `escrow.release` only.
- `apps/hub/src/call.ts`: the one line that builds `settlement.url`.
- `apps/hub/src/rails.ts`: the `HEDERA_SCHEDULED_RAIL=1` doc-comment lines only.
- New tests:
  - `packages/rail/src/hedera/test/held-link.test.ts`
  - `apps/hub/test/held-link.test.ts`
- Report: `$M/reports/hd-19-held-link.md`

## The decided change

1. **`types.ts`.** `SettleResult` gains:

   ```ts
   /** What the hub puts into the rail's explorer template instead of `transaction`, when the transaction that
    *  moved the money is not `transaction` itself (a held Hedera payment: the scheduled execution's consensus time). */
   explorerRef?: string;
   ```

2. **`held.ts`.** `escrow.release`'s success return gains `explorerRef: record.consensusTimestamp`, where `record` is the scheduled execution record it already waited for. Everything else in that return is unchanged, including `transaction: hold.createTxId`.
3. **`call.ts`.** The line `settlement.url = explorerUrl(match.rail.declaration, closeTx);` becomes `settlement.url = explorerUrl(match.rail.declaration, closing.explorerRef ?? closeTx);`.
   - `closing` is the existing `let closing: SettleResult` in that function: the settle result, replaced by the release result on escrow rails.
   - Keep the existing guard that skips an empty `explorerTx`.
4. **`rails.ts`.** The doc lines for `HEDERA_SCHEDULED_RAIL=1` become exactly:

   ```
    *   HEDERA_SCHEDULED_RAIL=1 -> rail "hedera-scheduled" (a held Hedera payment: the buyer's schedule moves no USDC
    *                                               until the seller's key signs it; this hub submits the seller's
    *                                               countersignature only after a checked delivery, but the seller's
    *                                               key can also release it alone; the hub holds no key)
   ```

## Tests

- **`held-link.test.ts`**, built like the existing held tests:
  - a successful `release` returns `explorerRef` equal to the execution record's `consensus_timestamp`, and `transaction` equal to the create transaction id.
- **`apps/hub/test/held-link.test.ts`**, built like `apps/hub/test/held.test.ts`:
  - the fake held rail's `release` returns `explorerRef: "1793978983.950527764"`;
  - the 200's `slip.settlement.url` ends with `/transaction/1793978983.950527764`;
  - `slip.settlement.transaction` is still the create transaction id;
  - for a rail whose release returns no `explorerRef`, the url is built from the transaction exactly as before.
- Every existing test passes unedited.

## Constraints

- **No browser.** **No network.** **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Scope.** Change nothing outside the lease. Never stage `bun.lock`. No new dependencies. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/rail/src/hedera apps/hub && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-19` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
