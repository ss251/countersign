> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review c2eb5eb (cs/hd, hd-03 merged) — B5 fix
Result: **blockers=0 should-fix=2**. B5 test passes unchanged; hedera suites pass (rail and agent).
Closed: the transaction id is claimed atomically before the facilitator is called (parallel replays and a second settle lose the claim); the chain tiebreaker returns `replay` when the mirror's consensus time is older than the attempt (minus 5 s skew), so a duplicate no longer turns into a second success; settle re-checks the payer signature; the signed validity window is bounded by the offer's `maxTimeoutSeconds` and a future-dated validStart is refused.
Should-fix:
1. **The default `seen` store is in memory.** With two hub instances (or a restart) the claim is not shared; the consensus-time check still refuses an old replay, but a replay sent to a second instance within the 5 s skew of the original consensus is read as that instance's own settlement. Pass a persistent shared store in the hub.
2. **A claimed id is never released.** If the facilitator is down the buyer's identical retry is refused as `replay`; the agent must re-sign. Acceptable, but make the agent do it automatically and say so in the error text.
