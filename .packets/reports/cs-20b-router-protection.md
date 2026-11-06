# cs-20b-router-protection — report

Date: 2026-11-06
Branch: `cs/cs-20`

## Landed

### 1. Protection comes before price

- A rail is **protected** when its declaration `kind` is `escrow`; every other kind is unprotected.
- `chooseRail` now sorts healthy before degraded, then (unless the buyer opts in) protected before unprotected, then cost, finality, rail id.
- `BuyerCaps` gained `allowUnprotected?: boolean`. A buyer opts in either by setting it or by naming at least one declared unprotected rail in `caps.rails`.
- Unprotected rails stay eligible and listed. A Gateway-only buyer still finds and pays the gateway entry.
- The hub reads `X-Countersign-Allow-Unprotected: 1` (trimmed; any other value is ignored).
- An unprotected fallback pushed down by protection carries the exact suffix
  `": does not refund the buyer, listed after the escrow rails"`, e.g.
  `fallback 1: does not refund the buyer, listed after the escrow rails`.
- `ROUTER_POLICY` is now exactly:
  `eligible by buyer rails and finality; healthy first, then protected (escrow) before unprotected unless the buyer opts in, then lowest cost, then fastest finality, then rail id`
- The reason names protection (`<rail>: protected rail, listed before unprotected rails (...)`) or the opt-in (`<rail>: cheapest acceptable rail, the buyer allows unprotected rails (...)`), and still names a degraded or demoted rail when that forced the fallback.

### 2. Health is keyed by rail and offer

- `HubRouter` stores health as `offerHash -> railId -> {failures, lastFailureAt}`.
- `recordFailure(offerHash, railId, now)` and `recordSuccess(offerHash, railId)` take the offer.
- `challengeOptions` passes only this offer's record into `chooseRail`; one offer's broken challenge or late signature cannot degrade a rail for another offer.
- `/healthz` groups health by rail and reports only currently degraded offers:
  `health: { <railId>: { degradedOffers: number } }` (settle/challenge failures at `failures >= 2` inside the 600 s window). `healthz(now)` accepts an explicit clock for tests; the HTTP route uses the wall clock.

### 3. Attempts are bounded

- At most 20 attempts are kept per `offerHash:payer` key.
- Keys with no attempt inside 600 s are evicted by the existing prune pass.
- `slipAttempts` copies at most the last 5 into `slip.settlement.route.attempts`; the full bounded log remains available through `attemptsFor`.
- The recent-decisions log stays at 20.

## Tests

Added or extended in the leased test files:

- `packages/rail/test/router.test.ts`
  - no opt-in: escrow (100 bps) beats gateway (0 bps), gateway is fallback 1, and its `why` is exact;
  - `allowUnprotected: true`: gateway wins;
  - `rails: ["gateway"]`: opt-in, gateway wins;
  - only unprotected candidates: no misleading escrow suffix;
  - existing finality, cap, degradation/expiry, id tie-break and whole-trace tests still pass.
- `apps/hub/test/route.test.ts`
  - standard 402 orders escrow first and the gateway `why` is exact; `X-Countersign-Allow-Unprotected: 1` puts gateway first;
  - a Gateway-only buyer sees the gateway in the accepts and pays it;
  - health on (gateway, offer A) degrades gateway for A only, leaves B's ranking unchanged, and expires after 600 s;
  - 30 attempts on one key keep 20, a slip gets 5, and an idle key is evicted after 600 s with the injected clock;
  - a paid slip with 7 recorded attempts carries the last 5;
  - `/healthz` shape updated to the grouped degraded-offer count.

## Existing test changes (ordering / shape only)

- `apps/hub/test/call.test.ts` — `an unpaid call answers 402 with the same body in the header`: accepts order for `["eip3009", "escrow"]` becomes `[eip155:5042002, eip155:1874]` and the first-entry network assertion follows. This is the only existing accepts-order change. This file is outside the literal lease; the packet asked for expected-ordering updates to be made and listed.
- `apps/hub/test/route.test.ts` — the old `/healthz` assertion expected raw `{failures, lastFailureAt}` for one failure; it now asserts the grouped shape (one failure is not degraded).
- `packages/rail/test/router.test.ts` — the old “cheapest wins” case became the protection case; the opt-in reason now includes the opt-in phrase.

No production code outside the lease changed. `discovery.ts` needed no change; its `health` parameter is already a per-offer record supplied by the caller.

## Verification

From the worktree root:

```
bun install                                                        # 182 packages, no changes
bun run typecheck                                                  # pass
bun test packages/rail apps/hub                                    # 198 pass, 0 fail
bun test                                                           # 674 pass, 3 skip, 0 fail
forge test                                                         # 47 pass, 0 fail
```

The 3 skips are the pre-existing `apps/web/test/onchain.live.test.ts` suite gated by `CS_LIVE=1`; no new test is skipped.

No browser, Chrome/Chromium, Playwright, Puppeteer or screenshot tool was launched. No live rail, chain or facilitator call was made; every hub/slip test used fake rails and a local Bun server.
