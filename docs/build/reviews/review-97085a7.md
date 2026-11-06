> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 97085a7 (PR 215, cs/phone-04, #26): the phone runner answers the hub's canary

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**.

- **It mirrors the runner daemon from #186.**
  - For an offer the phone serves, it signs `canaryMessage(skill.hash, nonce)` with its seller key. That is EIP-191 text with the fixed prefix `countersign canary`, the phone's own served hash, and the hub's nonce last.
  - Any other offer gets `canary-fail` `not-served`, and no skill runs.
- **Not a signing oracle.** As in #186, a hub-chosen nonce cannot turn this into a delist, publish or hello signature, and EIP-191 text cannot collide with the EIP-712 slip and release signatures. No money is involved.
- **Tests.** On 97085a7 with a frozen install, the phone's and the runner's canary tests give 4 pass and 0 fail, and `bun test apps/phone` gives 31 pass and 0 fail.
