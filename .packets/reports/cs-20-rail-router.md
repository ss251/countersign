# cs-20-rail-router — report

Date: 2026-11-06
Branch: `cs/cs-20`

## Landed

### The policy
- `packages/rail/src/router.ts` exports `chooseRail(offer, caps, declarations, health, now)`: pure, deterministic and clock-free. It produces one trace entry per rail in `offer.rails`, in offer order, with the exact refusal strings from the packet.
- Cost is computed with `BigInt`: `floor(price * tollBps / 10000) + fixed`. A missing cost counts as `{tollBps: 0, fixed: "0"}`.
- A rail is degraded at `failures >= 2` within 600 seconds. Candidates sort healthy before degraded, then cost, then `finalitySeconds` (undeclared last), then rail id. Eligible trace entries get `chosen` / `fallback N`.
- The reason names the winning rail, the degraded rail that forced the fallback (`<rail>: <other> failed twice in the last 10 minutes`), or the cheapest-acceptable sentence from the packet.

### Declarations
| Rail | `finalitySeconds` | `cost` |
|---|---|---|
| escrow (Arc) | 2 | `{tollBps: 100, fixed: "0"}` |
| whitechain | 6 | `{tollBps: 100, fixed: "0"}` |
| gateway | 900 | `{tollBps: 0, fixed: "0"}` |
| hedera | 5 | `{tollBps: 0, fixed: "0"}` |

`escrowRail` gained optional `finalitySeconds` and `cost` config fields so the wrapper rails can name their own values; the other rails are untouched.

### The hub
- `apps/hub/src/route.ts` holds the in-memory health record, the ten-minute attempt log, the last twenty decisions, header parsing and the challenge pass.
- `X-Countersign-Rails` accepts a comma-separated list of known ids; `X-Countersign-Max-Finality` accepts a positive integer. A malformed value is ignored as if absent.
- `challengeOptions` now calls the policy, drops ineligible rails, challenges in candidate order, and turns a thrown challenge into a health failure plus `why: "challenge failed: <first line>"`. The 402 carries `extensions.route = {chosen, reason, trace}`.
- A failed or thrown settle records `settle-failed`, increments health and demotes that rail for the next 402. A settle success records `settled`, resets the rail's failures and puts `{chosen, reason, attempts}` on `settlement.route` before the slip is stored.
- `/healthz` now includes `router: {policy, health, recent}`, where `recent` is the last twenty `{at, offerHash, chosen, candidates}` decisions.

### The hash rule
`RouteTrace` lives on `Slip.settlement`, outside `SlipBody`. `slipCommitHash(slip.body)` is unchanged; the settle-fallback test asserts it still equals `slip.hash`.

### Docs
`docs/spec/rail.md` gained a Router section covering eligibility, cost, degradation, ordering, headers, the 402/slip traces and `/healthz`.

## Tests

- `packages/rail/test/router.test.ts`: cheapest wins, finality filter with the exact `why`, buyer-rails filter, degraded ordering plus window expiry, id tie-break, and one deep-equal whole `RouteChoice`.
- `apps/hub/test/route.test.ts`: challenge fallback and trace, settle fallback with the next candidate first and `[settle-failed A, settled B]` on the slip, rail-header restriction plus malformed-header ignore, finality-header filtering, and `/healthz` policy/health/recent.

## Existing test change

One existing test asserted accepts order by position:

- `apps/hub/test/frontdoor.test.ts` — `lists two paid calls and a refund newest first` now finds the escrow and direct entries by network instead of taking `accepts[0]` and `accepts[1]`. The policy orders equal-cost, undeclared-finality ties by rail id, so `eip3009` now precedes `escrow` for that fake hub. No assertion changed; only entry lookup.

This path is outside the written lease, but the packet explicitly anticipated accepts-order edits and asked for them to be listed. No production behavior was changed to accommodate the test.

## Verification

From the worktree root:

```
bun install                                                        # 182 packages, no changes
bun run typecheck                                                  # pass
bun test packages/rail apps/hub                                    # 146 pass, 0 fail
bun test                                                           # 545 pass, 3 skip, 0 fail
forge test                                                         # 29 pass, 0 fail
```

The 3 skips are the pre-existing `apps/web/test/onchain.live.test.ts` suite gated by `CS_LIVE=1`; no new test is skipped.

No browser, Playwright, Puppeteer or screenshot tool was launched. No live rail, chain or facilitator call was made; every hub test used fake rails and a local Bun server.
