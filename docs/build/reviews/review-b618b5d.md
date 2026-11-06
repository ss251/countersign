> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Re-review b618b5d — B6 fix
Result: **blockers=0 should-fix=1**. B6 is closed: `buy()` refuses unless `canonicalHash(offer) == offerHash` before any terms check; my B6 test passes, `bun test packages/buyer` green (including my cs/w1 copy of the attack tests).
Stale lock: the lock now holds its owner pid and a dead owner is reclaimed.
Should-fix: the reclaim has a small race. Two processes that both see a dead owner can both `unlink`; the second may remove a lock the first has just recreated, and two buyers then pass `reserve` together. Reclaim by renaming the stale file to a unique name (atomic) and re-trying `wx`, or use an advisory `flock`.
My should-fix 2 (a failed entry without a reservationId) stays open by agreement; it leaks budget in the safe direction.
