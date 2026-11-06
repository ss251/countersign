# hd-01-fuzz: try to make the hedera rail accept a payment it must refuse

## Goal

The hedera rail (`packages/rail/src/hedera/`) accepts one exact shape of buyer payment: a Hedera `TransferTransaction` moving `amount` of one HTS token from the payer to `payTo`, fee paid by a known facilitator account, memo `cs1:<offer hash>`, signed, inside its validity window. Your job is to attack it. Write seeded, generated-input tests that try to get `checkTransfer`, `decodeTransfer` and the rail's `verify`/`settle` to accept anything else, or to reach a facilitator with a payment the rail should have refused first. You are a refuter: a test suite where everything passes because the inputs were easy is a failed packet.

## Lease

- Create `packages/rail/src/hedera/test/fuzz.test.ts`. No other file in the repository may change.
- Write your report to `/Users/thescoho/Developer/countersign-mumbai/reports/hd-01-fuzz.md`.

## Context

Read these first, in order:

- `packages/rail/src/hedera/inspect.ts`: `decodeTransfer`, `checkTransfer`, the refusal reasons.
- `packages/rail/src/hedera/rail.ts`: `createHederaRail`, and the `check()` it runs before any facilitator call.
- `packages/rail/src/hedera/memo.ts`: the offer memo.
- `packages/rail/src/hedera/test/fixtures.ts`: builds real signed transactions offline. Import from it; do not edit it.
- `packages/rail/src/hedera/test/rail.test.ts`: how to build a rail with a fake facilitator, a stubbed `verifyPayerSignature` and a fake mirror. Copy the pattern into your file rather than importing from it.

## Constraints

- No network. Freeze every transaction with `setNodeAccountIds`, as the fixtures do. Pass a fake `fetch` to anything that would reach a mirror node.
- Seeded PRNG only, with the seed printed in the test name, so every failure reproduces. Generate at least 300 cases per property and keep the whole file under 30 seconds.
- Cover at least these properties:
  1. Any single mutation of a valid payment is refused by `checkTransfer`. Mutations: amount ±k, payee, payer, token, fee payer, memo (other hash, truncated, uppercased, padded, empty), extra token entries, any HBAR entry, NFT-free splits across 3+ accounts, payer equal to fee payer or payee, unsigned, and a check time at or after the validity window ends.
  2. A correctly built payment with random amount (1 to 10^15) and random account ids is accepted, and `payer` is the debited account.
  3. `rail.verify` and `rail.settle` never call the fake facilitator for a payment that `checkTransfer` refuses. Count the calls.
  4. Changing any one of `amount`, `asset`, `payTo`, `network`, `scheme`, `maxTimeoutSeconds` or `extra.offerHash` between `payment.accepted` and the hub's requirements gives `isValid: false`. Changing only `extra.feePayer` to another known facilitator's fee payer is allowed; an unknown one is refused.
  5. `decodeTransfer` on random bytes, truncated real transactions and non-transfer transactions throws `InspectError` and nothing else.
- Run `bun install` in the worktree if `node_modules` is missing. Never stage or commit `bun.lock`.
- Do not change source files to make a test pass. If a property finds an input the rail accepts but should refuse, keep that test as a normal failing test, name the input in the report, and stop.

## Acceptance

```
bun test packages/rail/src/hedera && bun run typecheck
```

This must pass, unless it fails only on tests you list in the report as real acceptance bugs. Commit `fuzz.test.ts` alone on branch `cs/hd-01` with a short present-tense message, no trailers.

## Stop conditions

- A source change seems necessary: stop and explain in the report.
- Any network call is needed: stop.
- The suite cannot run under 30 seconds: cut the case counts and say so in the report.
