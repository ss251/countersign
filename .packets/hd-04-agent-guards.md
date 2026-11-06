# hd-04-agent-guards: no envelope overspend from parallel buys, no signing for unknown fee payers

## Goal

The money-path review of the hedera agent (`packages/buyer/src/hedera/agent.ts`) left two should-fixes:

1. **Parallel buys overspend.** `buy()` checks the envelope against `spent` but records the spend only after a 200. Two `buy()` calls running at the same time both pass the cap before either records. Reserve the amount before signing and release it only when the payment certainly did not land.
2. **A hub can park a signed payment.** The agent signs a transfer naming whatever `extra.feePayer` the hub's 402 gives. It cannot move value elsewhere, because payee, token and amount are checked against the listing. But a hostile hub can name a fee payer that never settles, which holds the agent's signed payment until it expires. Sign only for fee payers the agent trusts.

## Lease

- `packages/buyer/src/hedera/agent.ts`.
- `packages/buyer/src/hedera/test/agent.test.ts`: add tests; keep every existing assertion.
- `scripts/hedera/agent-run.ts`: pass the trusted fee payers (step 2) and add `--json` (step 3).
- `scripts/hedera/audit.ts`: add `--json` (step 3).
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-04-agent-guards.md`.

## Context

Read `agent.ts`, `test/agent.test.ts`, `packages/core/src/envelope.ts` (`checkEnvelope`, `recordSpend`), `packages/rail/src/hedera/facilitator.ts` (`httpFacilitator(...).feePayer()`), `packages/rail/src/hedera/constants.ts` (`FACILITATORS`), and the review at `/Users/thescoho/Developer/countersign-mumbai/reports/review-cde4ad8.md` (should-fix 1 and 3).

## Required changes

1. **Reservation.**
   - Keep pending spends next to `spent`.
   - The envelope check and the reservation happen together, with no `await` between them. JavaScript runs that stretch without interruption, so two buys cannot both pass.
   - The check runs against `spent` plus every pending amount.
   - On a 200, or on a non-200 where the chain shows the transfer landed, move the reservation into `spent`.
   - When nothing landed, drop it.
   - When the payment request throws before an answer, keep it reserved until the chain check says it did not land.
   - The `spent` getter keeps returning settled spend only.
2. **Trusted fee payers.**
   - Add the option `trustedFeePayers?: string[]`.
   - If it is omitted, the agent asks each facilitator in `FACILITATORS` for its fee payer once, on the first `buy`, and trusts those.
   - A challenge whose `extra.feePayer` is not trusted is refused before the envelope, nothing is signed, and nothing is logged. Return `{kind: "refused", reason: "untrusted-fee-payer", message: "Refused. The hub named a fee payer this agent does not trust."}`.
   - `agent-run.ts` passes the fee payers it reads from `FACILITATORS` up front, and also `HD_OPERATOR_ID`, because the hub's last-resort local facilitator uses the operator.
3. **Evidence for the demo page.** With `--json`, both scripts print their usual lines to stderr. They print exactly one JSON object to stdout at the end.
   - `agent-run.ts` prints `{beat: "hedera", ok, evidence: [{label, value, url?}]}`. `ok` is true when the run did what it was asked: every requested buy either paid or was refused by the envelope. Entries, in order:
     - `agent`, with its HashScan account URL;
     - `offer`, the offer hash;
     - `facilitator`, the facilitator name for the challenge's fee payer, taken from the trusted set;
     - `payment`, the transaction id, with its HashScan transaction URL;
     - `spend log`, as `#<sequence>`, with the HashScan topic URL.
     When a refusal happened, also add `refusal` (the sentence) and `refusal log` (`#<sequence>`, with the topic URL).
   - `audit.ts` prints `{beat: "hedera-audit", ok, evidence: [{label: "matched", value}, {label: "unbacked", value}, {label: "unlogged", value}]}`, with `ok` true when unbacked and unlogged are both 0.
   - Use `hashscanTx`, `hashscanAccount` and `hashscanTopic` from `@countersign/rail/hedera`.
4. **Tests**, offline with the existing fakes:
   - two parallel buys under a cap that fits exactly one: one pays, one refuses `over-cap`, and the total spent equals one price;
   - a failed call whose transfer did not land releases its reservation, so the next buy fits;
   - an untrusted fee payer is refused with no `PAYMENT-SIGNATURE` request and no log entry;
   - a trusted fee payer from the explicit list pays.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No network in tests. Inject `trustedFeePayers` in the tests so no facilitator is called.
- Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` first if `node_modules` is missing.

## Acceptance

```
bun test packages/buyer/src/hedera packages/rail/src/hedera && bun run typecheck
```

Both must pass with no skipped tests. Commit on `cs/hd-04` with short present-tense messages and no trailers.

## Stop conditions

- A change outside the lease looks necessary: stop and explain in the report.
- A rail test fails that this packet did not touch: stop and report. Another packet owns the rail.
