> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review d407fb2 (PR 224, cs/tr-07, #26, D18 amended): CANARY=report

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

- **`CANARY=report` runs the same rounds and delists nothing.**
  - A failing offer logs `[canary] would delist <hash>: <reason>` and skips `delistOffer`.
  - A passing offer logs `[canary] ok <hash>`.
  - Offline runners are still skipped.
- **`CANARY=1` is unchanged.** Anything else is off, and the hub logs `[hub] canary: off|report|delist` at start.
- **`runCanary` also returns `failed`.** The logs carry only offer hashes and failure reasons, with no keys or signatures.
- **This is the safe way to switch the canary on.** Run it in report mode against production until every live runner answers. That was my #186 note: a canary delist cannot be undone in the hub.
- **Tests.** On d407fb2 with a frozen install, `canary-report.test.ts` plus the unedited `canary.test.ts` and `delist.test.ts` give 16 pass and 0 fail.
