> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# cs-audit: re-run the Pashov audit on PR #164 (escrow v2) until it is bulletproof

The project lead's words (21:25 IST): "rerun pashov, contract should be bulletproof". This contract holds money on Arc and Whitechain and deploys tonight.

**Workspace:** $M/audit/164, a clean clone at origin/raj/98-escrow-v2 (9240aec). Read only: never edit the contract, a test or any file in the repo, never push, and never print keys.

**Run:** the solidity-auditor skill (Pashov, v4.1, ~/.claude/skills/solidity-auditor) in loop mode, 3 passes, from the workspace root.

- Scope: contracts/src (CountersignedEscrow.sol and its interface, the FeeSplit) and the deploy scripts (contracts/script).

**Context (intended behaviour, not findings):**
- $M/AUDIT-escrow-1945.md is the earlier audit (C1, C2, H1, M1, lows): verify each one is fixed, by name.
- The design is docs/spec/escrow.md "Escrow v2" and D16 in docs/decisions.md.
- The economics are decided:
  - a deadline default pays the buyer amount + bond;
  - an in-window dispute pays amount + bond;
  - a voluntary cancel returns the bond;
  - the arbiter's only power is failDelivery on a gate failure.
- **Option (d) is decided** and lands as a one-line change in fund: a bond > 0 requires msg.sender == arbiter, while unbonded jobs stay open to anyone. Audit the head as it stands, and treat a direct bonded fund as the known hole that (d) closes.
- When orch-cs posts the head that carries (d) (watch RUN-STATE for #164), fetch it and run the final pass there.

**Output:** for each run, write $M/reports/pashov-164-<sha>.md. Each finding gives:
- the severity;
- the exact location;
- a concrete exploit path with numbers;
- the fix;
- a test that fails on the current code.

**Post:** one line to $M/RUN-STATE.md when each run ends:

`<UTC ts> cs-audit REVIEW <sha> (PR 164, Pashov loop x3) critical=N high=N medium=N low=N report=<path>`

Then go idle until orch-cs posts the next head to re-audit. Findings go to Rajdeep and orch-cs, who fix them with red-then-green tests. The merge waits until a final pass on the merge head is clean of criticals, highs and mediums.
