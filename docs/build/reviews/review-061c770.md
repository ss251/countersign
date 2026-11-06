> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 061c770 (PR 194, cs/30-identity-sticky): the ERC-8004 identity stops flapping

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

- **When a lookup fails, the hub keeps the last identity it found for that seller.**
  - This covers `getBlockNumber` failing, or a log window failing twice: each window is now retried once.
  - The failure is cached for 30 s instead of 10 minutes.
  - A successful lookup is cached for 10 minutes as before. Only a found identity is remembered.
- **The identity is display and reputation only.** A last-known value shown during an RPC outage is the honest choice, and "never a failed request" still holds.
- **Tests.** On 061c770 with a frozen install, `identity-sticky.test.ts` gives 4 pass and 0 fail.
- **Note.** A successful lookup that finds nothing does not clear the remembered identity. A later failure could then show it again. ERC-8004 `Registered` logs only ever add, so this is harmless.
