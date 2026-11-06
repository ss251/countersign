# cs-20-rail-router — pick the cheapest rail with acceptable finality, fall back on failure, and record why (refs #94)

## Setup

Run `bun install` at the worktree root before anything else.

## Goal (the captain's words)

"A thin selection layer in packages/rail that, given an offer and the buyer's capabilities, picks the cheapest rail with acceptable finality and falls back to the next one if the first challenge or settle fails, recording which rail was chosen and why on the slip and in /healthz. Not a chain abstraction, not a bridge, just a deterministic policy with a trace."

## Lease

You may create or change only these paths:

- `packages/rail/src/router.ts` (new), `packages/rail/src/index.ts` (the export) and `packages/rail/test/router.test.ts` (new)
- `packages/rail/src/rail.ts`: two optional `RailDeclaration` fields, `finalitySeconds?: number` and `cost?: {tollBps: number; fixed: string}`
- `packages/rail/src/escrow/index.ts`, `gateway/index.ts`, `whitechain/index.ts` and `hedera/rail.ts`: fill those two fields only, from the table below
- `packages/core/src/types.ts`: only `Slip.settlement.route?: RouteTrace` and the `RouteTrace` type
- `apps/hub/src/route.ts` (new): the health record, the recent-decision log and the hub glue
- `apps/hub/src/discovery.ts`: `challengeOptions` only, which orders its options by the router
- `apps/hub/src/call.ts`: three small hooks only. Put all logic in `route.ts`.
- `apps/hub/src/app.ts`: the `/healthz` router field only
- `apps/hub/test/route.test.ts` (new)
- `docs/spec/rail.md`: a "Router" section
- `.packets/reports/cs-20-rail-router.md`

Do not edit `packages/runner/**`: another lane holds it.

## What to build

### 1. The policy (`packages/rail/src/router.ts`, pure and deterministic)

```ts
export interface BuyerCaps { rails?: RailId[]; maxFinalitySeconds?: number }
export interface RailHealth { failures: number; lastFailureAt: number }   // unix seconds
export interface RailTraceEntry { rail: RailId; eligible: boolean; cost: string | null; finalitySeconds: number | null; why: string }
export interface RouteChoice { candidates: RailId[]; chosen: RailId | null; reason: string; trace: RailTraceEntry[] }
export function chooseRail(offer: Offer, caps: BuyerCaps, rails: RailDeclaration[], health: Record<string, RailHealth>, now: number): RouteChoice
```

**One trace entry per rail id in `offer.rails`, in offer order.** A rail is eligible only when all of these hold:

- the hub has a declaration for it. Otherwise `why` is "this hub does not run it";
- when `caps.rails` is set, the buyer can pay it. Otherwise "the buyer cannot pay it";
- when `caps.maxFinalitySeconds` is set, the rail has `finalitySeconds` no greater than the maximum. Otherwise "finality N s is slower than the buyer's M s", or "finality is not declared".

**`cost`** is `floor(price * cost.tollBps / 10000) + cost.fixed`, an atomic string. A missing `cost` counts as `{tollBps: 0, fixed: "0"}`.

**A rail is degraded** when `failures >= 2` and `now - lastFailureAt <= 600`.

**`candidates`** are the eligible rails sorted by:

1. healthy before degraded;
2. cost, lowest first;
3. `finalitySeconds`, lowest first, with undeclared last;
4. rail id, alphabetically.

**`chosen`** is the first candidate, or null.

**`reason`** is one plain sentence for the chosen rail. For example: "escrow: cheapest acceptable rail (cost 100, finality 2 s)", or "gateway: escrow failed twice in the last 10 minutes".

**`why`** for an eligible rail states its rank: "chosen", "fallback 1" and so on.

### 2. Declaration values

| Rail | `finalitySeconds` | `cost.tollBps` | `cost.fixed` |
|---|---|---|---|
| escrow (Arc) | 2 | 100 | "0" |
| whitechain | 6 | 100 | "0" |
| gateway | 900 (the seller is credited in Gateway's next batch) | 0 | "0" |
| hedera | 5 | 0 | "0" |

Leave the other rails unset.

### 3. The hub (`apps/hub/src/route.ts` plus the hooks)

**Buyer caps** come from two optional request headers:

- `X-Countersign-Rails: escrow,gateway` (comma-separated ids);
- `X-Countersign-Max-Finality: 60` (a positive integer).

Malformed values are ignored, as if absent. Read them only from the headers.

**Health** is in memory:

- `recordFailure(railId, now)`: a challenge that throws, or a settle that fails or throws;
- `recordSuccess(railId)`: resets that rail's failures to 0.

**`challengeOptions`** takes optional caps and health, and returns `{options, route}`:

- it orders the options by `route.candidates`;
- it drops rails that are not eligible;
- when no caps are given, every offer rail the hub runs stays, ordered by the policy;
- when a rail's `challenge` throws, it records a failure and adds the attempt to the trace: `why: "challenge failed: <first line>"`;
- `call.ts`'s 402 carries `extensions.route = {chosen, reason, trace}`.

**Attempts.** Keep `{rail, outcome: "challenge-failed" | "settle-failed" | "settled", at}` in memory, keyed by `offerHash + payer`, for 10 minutes.

- A settle failure records `settle-failed`, and the hub's usual 402 then lists the next candidates first, because the failed rail is now ordered lower.
- On success, the slip's `settlement.route` is `{chosen, reason, attempts}`, where `attempts` includes this success.

**`/healthz`** gains:

```
router: {
  policy: "eligible by buyer rails and finality; healthy first, then lowest cost, then fastest finality, then rail id",
  health,
  recent  // the last 20 decisions: {at, offerHash, chosen, candidates}
}
```

**Hook limits in `call.ts`:**

- pass the caps and route into the 402;
- record the outcome after settle;
- set `settlement.route` before the slip is stored.

Nothing else in `call.ts` changes.

### 4. The hash rule

`settlement.route` sits **outside** the committed slip body, like `settlement.receipt`. The seller does not attest the route; the hub records it. `slipCommitHash` must not change.

## Tests

**`packages/rail/test/router.test.ts`:**

1. **Cheapest acceptable wins:** gateway (cost 0) beats escrow (cost 1% of the price) when both are eligible.
2. **Finality filters:** with a 60 s maximum, gateway (900 s) is ineligible with the exact `why`, and escrow is chosen.
3. **Buyer rails filter:** with caps `["hedera"]`, only hedera is eligible.
4. **Degraded moves last:** two failures in 600 s put a rail after a costlier healthy rail, and a third failure 601 s later no longer counts.
5. **Ties:** equal cost and finality are ordered by rail id.
6. **The trace is exact:** deep-equal the whole `RouteChoice` for one fixed case.

**`apps/hub/test/route.test.ts`,** with fake rails:

- **Challenge fallback:** a rail whose `challenge` throws is dropped from the 402's accepts, and the trace says why.
- **Settle fallback:**
  - when the first rail's settle fails, the next 402 lists the other rail first;
  - paying on it succeeds;
  - the slip's `settlement.route.attempts` is `[settle-failed rail A, settled rail B]`;
  - `slipCommitHash(slip.body)` equals `slip.hash`, so the route is outside the hash.
- **Headers:** `X-Countersign-Rails` restricts the accepts; a malformed value is ignored.
- **`/healthz`** shows the policy, health and the recent decisions.
- Every existing hub test passes unedited, apart from accepts order where a test asserts it. List those in the report.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. TypeScript strict, no `any`. Deterministic: no `Math.random` and no wall clock in the policy.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail apps/hub && bun test && forge test
```

Every command passes, with no new skipped tests.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 20 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #94)`, and no trailers. Write `.packets/reports/cs-20-rail-router.md`. Do not push, merge or deploy.
