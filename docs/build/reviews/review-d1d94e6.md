> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review d1d94e6 — fix for B3 and escrow-rail should-fix 1
Result: **blockers=0 should-fix=0**. B3 test passes; `bun test packages/rail` 6/6. The deadline check is one-sided (`>= now + offer.deadline - 15`, `<= +300`); a receipt timeout now returns `errorReason: "pending"` with the hash instead of throwing. B3 closed.
