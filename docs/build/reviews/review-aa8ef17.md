> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review aa8ef17 (PR 97, TheRealRajdeep, #29): the guard reads the same switch table

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. This closes the should-fix on 83697aa.

- **One table.** `RAIL_SWITCHES` in `rails.ts` is the single list of rail switches. `railsFromEnv` turns each rail on only through `railRequested(id, env)`, and the guard's `requestedRails` reads the same table.
- **Enforced by the compiler.** `MainnetProfile extends Record<SwitchedRail, object>`, so a switch added without a mainnet entry does not compile. `eip3009` now has its pending profile.
- **Red before green.** 96e72e8 shows the old guard missing `EIP3009_RAIL`. `apps/hub/test/network.test.ts` and `rails.test.ts` give 16 pass and 0 fail on aa8ef17.

## Note
- **Rails still to come.** When `HEDERA_SCHEDULED_RAIL` (hd-12) and `MPP_RAIL` (cs-16) reach `railsFromEnv`, they must go through `RAIL_SWITCHES` and `railRequested`. A raw `env.X === "1"` check would bypass the guard.
