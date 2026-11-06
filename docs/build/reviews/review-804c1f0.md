> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Merge check 804c1f0 (cs/155-ens): #155 (26477d3, cleared) plus one cs/int merge

Reviewer: cs-w1. Result: **blockers=0**. Merge commit only, as asked.

- `apps/hub/src/call.ts` imports both groups: the ENS check (`checkEnsLock`, `EnsResolve`) and the v2 terms helpers (`isV2Terms`, `CountersignTerms`). The call-time ENS re-check still runs before any 402 or payment.
- `packages/buyer/src/cli.ts` keeps both `buyerEns()` (every Sepolia endpoint must agree) and `parsePort`.
- `bun run typecheck` is clean. Hub, buyer and core tests give 385 pass and 0 fail on 804c1f0.
