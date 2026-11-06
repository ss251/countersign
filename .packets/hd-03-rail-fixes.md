# hd-03-rail-fixes: settle a Hedera payment at most once, and tighten the signed-transfer checks

## Goal

The money-path reviewer found a blocker in the hedera rail. Replay the same signed payment on a fresh rail instance (hub restart, second hub, or a parallel call): the facilitator refuses the duplicate, then the rail's chain tiebreaker finds the original `SUCCESS` on the mirror node and reports a second success. Fix that, so a payment is reported settled at most once and only for the attempt that actually landed it. In the same pass:

- make `settle` run the payer-signature check that `verify` already runs;
- refuse signed transfers that are not valid yet, or that stay valid longer than the rail allows.

Two failing tests already define the work:

- `W1 B5` in `packages/rail/src/hedera/test/w1-attacks.test.ts`;
- the fuzz test with seed `0x51ee1002` in `fuzz.test.ts`, which you will retarget (step 2).

## Lease

- `packages/rail/src/hedera/inspect.ts`, `packages/rail/src/hedera/rail.ts`, and `packages/rail/src/hedera/index.ts` (exports only).
- `packages/rail/src/hedera/test/fuzz.test.ts`, `rail.test.ts` and `inspect.test.ts`.
- `packages/buyer/src/hedera/signer.ts`: one change, step 4.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-03-rail-fixes.md`.
- `packages/rail/src/hedera/test/w1-attacks.test.ts` belongs to the reviewer. It must pass unchanged. Do not edit it.

## Context

Read `rail.ts` (`check`, `settle`, `confirmOnChain`), `inspect.ts` (`checkTransfer`), all four files in `test/`, and the review at `/Users/thescoho/Developer/countersign-mumbai/reports/review-cde4ad8.md`.

## Required changes

1. **Settle once.**
   - Add an option `seen?: SettledStore`, where `SettledStore = { has(id: string): boolean | Promise<boolean>; claim(id: string): boolean | Promise<boolean> }`. `claim` records the id atomically and returns false when the id was already there. The default is an in-memory store. Export the type.
   - `verify` refuses with reason `replay` when `has(transactionId)`.
   - `settle`: after the local checks and the signature check (step 2), call `claim(transactionId)` before any facilitator call. If it returns false, refuse with `replay` and call nothing. Claims are never released: a payment that fails is re-signed, never retried.
   - **Chain tiebreaker:** record `startedAt = now()` immediately before the facilitator `settle` call. A mirror record counts as this attempt's settlement only when all of these hold:
     - `result === "SUCCESS"`;
     - the net credit and debit are exact;
     - its `consensusTimestamp` seconds are at or after `startedAt - clockSkewSeconds`. `clockSkewSeconds` is a new option, default 5.

     An older record means the payment landed before this attempt, so it is a replay. Return `success: false, errorReason: "replay"`.
   - Fix the existing `rail.test.ts` fake mirror so its "landed" case uses a consensus time after the attempt, built from the test's `now`. Add a test that a record older than the attempt is a replay. Weaken no assertion.
2. **Signature on settle.** `settle` calls `verifyPayerSignature` after the local checks and before `claim`, and refuses with `signature_invalid`.
   - Retarget fuzz seed `0x51ee1002`: payer-substituted payments, built as that test builds them, must be refused by both `rail.verify` and `rail.settle` with `signature_invalid`. Use an account-bound stub (`({payer}) => ({ok: payer === PAYER})`) and assert zero facilitator calls.
   - `checkTransfer` cannot bind an account to a key offline. Say so in a one-line comment there and leave that behaviour as it is.
3. **Validity window.**
   - `ExpectedTransfer` gains `maxTimeoutSeconds`. `checkTransfer` refuses `validDurationSeconds > maxTimeoutSeconds` (reason `validity_too_long`) and `validStart > now + 10` (reason `not_yet_valid`).
   - Add both reasons to `HederaRefusal` and `HEDERA_REFUSALS`, worded "Refused. The signed payment is not valid yet." and "Refused. The signed payment stays valid longer than this offer allows."
   - The rail passes `requirements.maxTimeoutSeconds`.
   - `challenge` clamps `maxTimeoutSeconds` to between 30 and 180.
   - Add both as mutations to fuzz property 1, and a direct test of each to `inspect.test.ts`.
4. **Signer.** `signHederaTransfer` sets the valid duration to `Math.min(req.maxTimeoutSeconds, 180)`, so it never exceeds what the rail allows.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No network in tests. Use the fakes the existing tests use.
- Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.
- Keep the refusal wording style: declarative, starting with "Refused.", no exclamation marks.

## Acceptance

```
bun test packages/rail/src/hedera && bun run typecheck
```

Everything must pass, including `W1 B5` unchanged and the retargeted fuzz test, with no skipped tests. Commit on `cs/hd-03` with short present-tense messages and no trailers.

## Stop conditions

- `W1 B5` cannot pass without editing it: stop and explain in the report.
- A change outside the lease looks necessary: stop and explain.
