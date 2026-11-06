> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Re-review c58ff12 (PR 165, cs/hd-14, closes #163): B22 fixed

Reviewer: cs-w1. Result: **blockers=0 should-fix=0**. `packages/verify` gives 29 pass and 0 fail on c58ff12, and my `w1-verify-held.test.ts` (cs/w1 1e78a3a) is byte-identical there.

- **B22: closed.** `checkHeld` now refuses unless `slip.body.jobId` equals `keccak256(toBytes(createTxId))`, the job the hub assigns a held payment. The finding reads: "the seller signed job X, not the job this schedule paid (Y)". The mirror proof is now tied to the seller-signed job.
- **Test changes, checked under the no-weakening rule.**
  - `e2e-163.test.ts` changes only its fixture: the held slip's `jobId` was an arbitrary hash and is now the real derivation. Its assertions are unchanged. The old fixture was exactly the inconsistent slip the new rule refuses.
  - `held.test.ts` adds a refusal test.
  - No assertion was edited, skipped or deleted.
