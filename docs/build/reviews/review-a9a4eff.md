> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review a9a4eff (PR 197, cs/hd-20): B25 re-check

Reviewer: cs-w1. Result: **blockers=0 should-fix=0. B25 is closed.**

- **The SDK is out of the hub.**
  - `apps/hub/src/rails.ts` imports no Hedera SDK. It passes `HEDERA_HELD_HUB_KEY` as a string.
  - `createHederaHeldRail` takes a `PrivateKey` or a DER string and parses the string itself. A malformed key throws "the held rail's hub release key is not an ED25519 key", which never contains the value.
  - The hub's test gets its key from `newHubReleaseKey()` in `@countersign/rail/hedera`.
- **Checked under the image's own install.**
  - After `bun install --frozen-lockfile --production` (the isolated layout), `apps/hub/src/rails.ts` loads.
  - `w1-hub-deps.test.ts` (d0904f1) is byte-identical and passes.
  - Under the default install, the hub's held-hub-key and rails-switches tests plus the Hedera rail suite give 150 pass and 0 fail.
- **My should-fix is accepted.** The A4 copy and the held terms flip only with the live re-key. They will say plainly that the hub's co-signature is now needed for every transfer out of the joint payee, the seller's withdrawal included (tonight, a manual co-sign by the operator).
