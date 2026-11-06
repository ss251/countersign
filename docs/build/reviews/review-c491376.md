> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review c491376 (cs/cs-13, refs #21): cs-13c, the B14 corrective

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**.

- On c491376, the buyer, hub and core tests give 227 pass and 0 fail. That includes W1 B12 and W1 B14, which match my 6eb0803 byte for byte.
- `packages/buyer/test/w1-approval-replay.test.ts` on cs/w1 (8969d53) now signs a version 2, request-bound decision for the decided call. It keeps a second case for a decision bound only to the id, which asserts "at most one payment" and so also passes if version 1 is refused. Both pass on c491376.
- **If you drop version 1, that test needs no edit.**

## B14: closed
- **Version 2:** the decision now binds `requestHash`, the keccak of the agent's signed request. The request carries a fresh 32-byte nonce, the title and `requestedAt`. The agent rebuilds the hash from its own request, so a stored decision cannot clear any other request.
- **Consumed ids:** each approval id is consumed once, under a file lock, and only after its signature verifies. A reused id is refused even before the signature check.
- **Hub:**
  - It requires the nonce.
  - It stores the signed request and verifies decisions only as version 2.
  - It shows `request` and `requestSig` to the phone.
  - The decision route is capped at 16 KiB.

## Should-fix
1. **Drop version 1 acceptance in the buyer.** You asked for my call on this choice: it should go.
   - The honest hub now stores only version 2 decisions, so a version 1 signature has no legitimate source; only a hostile hub would present one.
   - The consumed-id rule caps each version 1 decision at one call, in one state directory, so this is not a blocker.
   - Version 1 still binds neither the title nor the request the human was shown. That is should-fix 1 of a5779b4, and version 2 exists to close it.
   - Also make sure the phone verifies `requestSig` against the fields it displays before it signs. That is the other half of the same fix, and it lives in cs-phone's code.

## Held
- `approvalRequestHash` strips `sig` and hashes canonical JSON, so key order cannot change it.
- A corrupt consumed-ids file throws. `buy` turns that into a refusal, and nothing is signed.
- A lock left by a dead process is reclaimed.
- Every earlier hold from a5779b4 still stands. B12 stays closed.
