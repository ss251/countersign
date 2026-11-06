# cs-20b-router-protection — protected rails first unless the buyer opts in (refs #94)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-20` (the rail router), merged with `cs/int`.

## The design is decided (orch-cs; recorded in `docs/decisions.md`, "D13, amended", on this branch)

cs-w1 reviewed the router (bb5f265): 0 blockers and three should-fixes, all decided here.

1. **Protection comes before price (should-fix 3).**
   - **The problem.** Ranking by cost alone puts rails that cannot refund the buyer (declaration `kind` `direct` or `batched`: gateway, hedera, eip3009, mpp) ahead of escrow, because they carry no toll. The buyer takes the first entry it can pay, so it would pay unprotected by default. That contradicts the product's promise that payments move only when the work lands.
   - **The rule.** A rail is **protected** when its declaration `kind` is `escrow`.
     - **No opt-in:** the candidate order is healthy first, then **protected before unprotected**, then cost, then finality, then rail id. Unprotected rails stay eligible and listed, so a buyer that can only pay them (a Gateway-only client, the Hedera agent) still pays exactly as today.
     - **The buyer opts in:** cost competes across both kinds, as before. A buyer opts in with `X-Countersign-Allow-Unprotected: 1`, or with `X-Countersign-Rails` naming at least one unprotected rail.
   - **`BuyerCaps`** gains `allowUnprotected?: boolean`.
   - **The trace.** Each entry's `why` names protection, for example "fallback 1: does not refund the buyer, listed after the escrow rails". The `reason` names the rule.
   - **Policy string.** `/healthz`'s `router.policy` becomes "eligible by buyer rails and finality; healthy first, then protected (escrow) before unprotected unless the buyer opts in, then lowest cost, then fastest finality, then rail id".
2. **Health is keyed by rail and offer (should-fix 1).**
   - Health counts failures per `railId + offerHash`, not hub-wide, so one seller's misconfigured offer or one buyer's near-expiry signature cannot degrade a rail for everyone else.
   - `chooseRail` takes the health for this offer.
   - `/healthz` shows health grouped by rail, as a count of degraded offers.
3. **Attempts are bounded (should-fix 2).**
   - Keep at most 20 attempts per key, and evict keys idle for more than 10 minutes.
   - Copy at most the last 5 attempts into `slip.settlement.route.attempts`.
   - The recent-decisions log stays at 20.

## Lease

You may create or change only these paths:

- `packages/rail/src/router.ts` and `packages/rail/test/router.test.ts`
- `apps/hub/src/route.ts` and `apps/hub/test/route.test.ts`
- `apps/hub/src/discovery.ts` (`challengeOptions`) and `apps/hub/src/call.ts` (the router hooks only), if a signature changes
- `docs/spec/rail.md`: the Router section
- `.packets/reports/cs-20b-router-protection.md`

## Tests

- **No opt-in:** with escrow (100 bps) and gateway (0 bps) both eligible, escrow is chosen, gateway is fallback 1, and the `why` text is exact.
- **Opt-in:** with `allowUnprotected: true`, gateway is chosen. With caps `rails: ["gateway"]`, gateway is chosen.
- **A Gateway-only buyer** (a 402 consumer that skips the escrow entry it cannot pay) still finds the gateway entry. The hub test checks it in the accepts.
- **Health:**
  - two failures on (gateway, offer A) degrade gateway for offer A only, and offer B's ranking is unchanged;
  - expiry after 600 s still works.
- **Attempts:**
  - after 30 failed attempts on one key, at most 20 are kept;
  - a slip carries at most 5;
  - idle keys are evicted after 10 minutes, using an injected clock.
- **Existing router and hub tests** pass. Update the expected ordering only where this rule changes it, and list each change in the report.

## Constraints

- **Never launch a browser of any kind on this machine**: no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No view code. No network in tests. TypeScript strict, no `any`. The policy stays pure and deterministic.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/rail apps/hub && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #94)`, and no trailers. Write `.packets/reports/cs-20b-router-protection.md`. Do not push, merge or deploy.
