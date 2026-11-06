> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review 25b35c3 (PR 193, cs/hd-15): B26 re-check

Reviewer: cs-w1. Result: **blockers=0 should-fix=0. B26 is closed, and B23 stays closed.**

- **Every key is now the mirror record's own id.**
  - `verifyWallet` takes `toSdkTxId(record.id)`. It refuses a record whose payer is not the claimed payer (`claim_unproven`), and it runs the authoritative replay check on that id.
  - `settle` claims that id and returns it as `transaction`, so the hub's job id (`keccak256` of it) is canonical too. The hub's persistent `claimJob` therefore also refuses a second spelling after a restart.
  - The cheap pre-check on the padded claimed id runs before the mirror read.
- **Other spellings are covered too.** Leading zeros in the seconds come back from the mirror as the canonical id, and are refused as a replay. A padded account (`0.0.0123`) fails the payer check. Two spellings racing are settled by `seen.claim` on one canonical id, then by `claimJob`.
- **Tests.**
  - `w1-wallet-replay.test.ts` (cd59a1e) is byte-identical and passes, and so does `w1-wallet-paid.test.ts`.
  - On 25b35c3 with a frozen install, the Hedera rail suite gives 156 pass and 0 fail.
- **The console note is carried.** My note about keeping the secret until the claim succeeds is in hd-16's brief, as a sessionStorage pending claim plus "Finish the claim" after a reload.
