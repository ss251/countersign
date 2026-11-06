> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review e40386e (PR 182, cs/tr-01, #27, D17): a nested call that would close a cycle is refused before any 402

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. `lineage.test.ts` and `call.test.ts` give 20 pass and 0 fail, three runs in a row.

## Held
- **Order.** `lineageCycle` runs first in `paidCall`, before the ENS lock, both input gates, the payment header and any 402. A cycle answers 409 `lineage-cycle`, "Nothing was charged".
- **The rule.** It refuses when an ancestor job this hub knows bought the target offer, or any offer from the target's seller (case-insensitive). A jobId the hub does not know is skipped. That is the project lead's acceptance: a call whose lineage already contains the seller or the offer is refused before payment, with a 4xx and no 402.
- **Who it can affect.** The lineage is the caller's own list, so a caller can only refuse itself. Naming someone else's job blocks no one else.

## Notes
- **The lineage list has no length cap.** `hexList` keeps every hex string, and each costs two store lookups. Cap it at a sane depth (32, say) before the loop.
- **One flaky run.** `call.test.ts` "a rail whose challenge throws is skipped and the rest are offered" failed once when run together with `lineage.test.ts`, then passed three paired runs, alone twice on this head, and on its parent. It is a timing flake, not this diff; worth a look if it recurs in CI.
