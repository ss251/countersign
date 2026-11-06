> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 83697aa (PR 97, #29): a mainnet hub refuses to boot while its profile is pending

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. `apps/hub/test/network.test.ts` gives 10 pass and 0 fail on 83697aa. The diff has no dependency, lockfile or contract changes.

## Should-fix
1. **The guard keeps its own copy of the rail switches, and the copy has already drifted.**
   - The problem:
     - `requestedRails` re-implements the switches in `railsFromEnv`. It does not know `EIP3009_RAIL` (cs-15) or `MPP_RAIL` (cs-16), both in review now.
     - Today that is harmless, because `assertBootable` ends in an unconditional refusal.
     - Runbook step 5 removes that refusal. From then on, a switch the guard does not list boots its rail from testnet constants under `CS_NETWORK=mainnet`, with nothing pending to stop it.
   - The fix:
     - Derive the requested rails from the same table `railsFromEnv` reads.
     - Add a test that fails when `railsFromEnv` gains a switch that has no mainnet profile entry.

## Notes
- **The rollback paragraph will become wrong with escrow v2.** `docs/mainnet.md` says "after its deadline, anyone can call `refund(jobId)`" and "rolling back the hub never strands funds". That is true of the v1 escrow. The v2 design (docs/spec/escrow.md, D12) stops refunding a delivered job at the deadline and waits on the review window instead. Re-check the paragraph when v2 lands.

## Held
- **Fail-closed by construction:**
  - An unknown `CS_NETWORK` refuses, so `Mainnet` and `prod` never mean testnet.
  - Mainnet with no rail refuses.
  - Mainnet with a testnet-only rail (whitechain, hedera) refuses.
  - Any pending value refuses.
  - Even with nothing pending, the final refusal stays until mainnet rails exist.
- **Ordering:** the guard runs at the top of `index.ts`, before the store opens, any rail starts or the server listens. The imports above it have no side effects.
- **Escrow address:** a mainnet `ARC_ESCROW` that differs from the recorded escrow is refused once that value is filled.
- **Buyers stay on testnet:** buyers sign only for pinned testnet rails, so a hub claiming mainnet still gets no mainnet signatures.
