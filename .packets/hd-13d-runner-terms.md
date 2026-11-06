# hd-13d-runner-terms: the seller countersigns only its own offer's terms, never the hub's word for them

## Goal

This is cs-w1's should-fix on 5a9c00b (`$M/reports/review-5a9c00b.md`).

The seller's countersigner checks the schedule against the amount, asset and payee that the hub's order states. A dishonest hub could send an order, with a matching schedule, for less than the offer's price, and the seller would deliver and countersign it.

After this change:
- the runner refuses a held order whose terms differ from the offer it serves, before it does any work or signs anything;
- the seller script uses the asset constant, not the order's word.

Tracked by issue #41.

## Lease

- `packages/runner/src/daemon.ts`: the job handler only.
- `scripts/hedera/mcp-seller.ts`: the `asset` passed to `prepareCountersign` only.
- `packages/runner/test/countersign-terms.test.ts` (new).
- Report: `$M/reports/hd-13d-runner-terms.md`

## The decided design

1. **`daemon.ts`.** In the job handler, right after the deadline check and before the input check or any adapter run, add:

   ```ts
   if (order.rail === "hedera-scheduled") {
     if (!cfg.countersign || !order.schedule) {
       return refuse("Refused. This runner cannot countersign a held Hedera payment.");
     }
     if (order.amount !== entry.offer.price || order.payTo !== entry.offer.payTo?.["hedera-scheduled"]) {
       return refuse("Refused. The held order's terms differ from the served offer.");
     }
   }
   ```

   - `refuse(reason)` means exactly what the deadline check does just above it: `notify(order, entry.offer.title, false, reason)` then `return fail(target, order, reason)`.
   - Use the same two calls inline; do not add a helper unless the file already has one.
   - Leave the later countersign block as it is.
2. **`mcp-seller.ts`.**
   - In the countersigner, pass `asset: USDC_TESTNET` (import it from `../../packages/rail/src/hedera/constants.ts`) instead of `asset: order.asset`.
   - The amount and payee checks now happen in the daemon, so leave those fields as they are.

## Tests (`packages/runner/test/countersign-terms.test.ts`; use the fixtures `countersign.test.ts` uses)

Serve an offer with `price: "30000"` and `payTo: { "hedera-scheduled": "0.0.11338176" }`, and a countersigner that records its calls.

| Held order | Expected |
|---|---|
| `amount: "1"` | a `fail` frame with "Refused. The held order's terms differ from the served offer."; the countersigner is not called; the adapter (or child) never runs |
| `payTo: "0.0.999"` | the same refusal and the same two checks |
| matching terms | a `result` frame carrying `countersign`, as today |
| no countersigner configured | the "cannot countersign" refusal, before the adapter runs |

Every existing test passes unedited.

## Constraints

- **No browser.** **No network.** **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Never stage `bun.lock`.** Change nothing outside the lease. TypeScript strict, no `any`.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/runner && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-13d` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.
