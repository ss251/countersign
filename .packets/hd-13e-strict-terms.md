# hd-13e-strict-terms: the runner's held-terms gate is exactly the decided one

## Goal

hd-13d (packet `.packets/hd-13d-runner-terms.md`) guarded its terms check with `heldPayTo !== undefined && (…)`, so an offer that declares no held payee skips the check, and the amount check too.

The decided check refuses that case. A hub must not get a seller to countersign a held order for an offer that never declared a held payee, nor at another price.

hd-13d's worker relaxed the check only to keep hd-13's old fixture green. That fixture serves price `1000` with no `payTo`, while its held orders carry `10000` and `0.0.11337065`. **The fixture is wrong, not the gate.** Fix the fixture.

Tracked by issue #41.

## Lease

- `packages/runner/src/daemon.ts`: that one condition only.
- `packages/runner/test/countersign.test.ts`: the fixture offer in `beforeEach` only. Change no assertion.
- `packages/runner/test/countersign-terms.test.ts`: one new test.
- Report: `$M/reports/hd-13e-strict-terms.md`

## The decided change

1. **`daemon.ts`.** The terms condition becomes exactly:

   ```ts
   if (order.amount !== entry.offer.price || order.payTo !== entry.offer.payTo?.["hedera-scheduled"]) {
   ```

   Drop the `heldPayTo` variable if it is no longer used. The refusal and its message stay as they are.
2. **`countersign.test.ts`.** In `beforeEach`, the served offer becomes `{ ...skillOffer({ … , price: "10000", … }), payTo: { "hedera-scheduled": "0.0.11337065" } }`.
   - Its price is `"10000"` instead of `"1000"`.
   - `offerHash = hashOffer(offer)` is computed after, as today.

   This matches the held orders `makeOrder` builds (`amount: "10000"`, `payTo: "0.0.11337065"`). Change no assertion.
3. **`countersign-terms.test.ts`.** Add one test: a served offer with **no** `payTo`, and a held order (with `schedule`, and a countersigner configured). The answer is a `fail` frame with "Refused. The held order's terms differ from the served offer.", and the countersigner is not called.

## Acceptance

```
set -o pipefail; bun install && bun run typecheck && bun test packages/runner && bun test && forge test
```

Every command passes, with no new skips. Commit on `cs/hd-13d` with short present-tense messages ending `refs #41`, and no trailers. Write the report. Do not push, merge or deploy.

## Constraints

- **No browser.** **No network.** **No keys.**
- **Never run a script under `scripts/hedera/`.**
- **Never stage `bun.lock`.** Change nothing outside the lease. TypeScript strict, no `any`.
