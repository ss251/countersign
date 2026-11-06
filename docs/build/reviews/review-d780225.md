> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review d780225 (PR 211, cs/tr-05, #27, D17 amended): a lineage naming the offer or its seller is refused

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

- **The new line.** `lineageCycle` now refuses, with 409 before any 402, a lineage entry that equals the target's own offer hash or its seller. The compare is case-insensitive, and the line sits ahead of the existing known-ancestor checks.
  - `hexList` keeps hex strings of any length, so a 20-byte seller address reaches the comparison and is not filtered out.
- **The lineage is the caller's own claim,** so a caller can only refuse itself with it. No one can use it to block another buyer.
- **Tests.** On d780225 with a frozen install, `lineage-direct.test.ts` and `call.test.ts` give 17 pass and 0 fail. They cover the offer hash, the seller, case, and another offer still answering 402.
- **Note, carried from my e40386e review.** The lineage list is still uncapped, and it is stored on the job. Cap its length (32 entries, for example) when convenient.
