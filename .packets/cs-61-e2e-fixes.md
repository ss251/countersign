# cs-61-e2e-fixes: three suite-side fixes from run 20261106-153202-cdae

Lane: cs-e2e. Base: `cs/e2e`. Branch: `cs/cs-61`. Three small, independent changes in `e2e/`, each its
own commit. Each makes a check wait for, or look for, the real thing, and no assertion gets weaker:
every check below still requires what it required before.

## 1. production-hub (14b): read a slip from a settlement that has one

File: `e2e/flows/production.flow.ts`, the step "the hub has a listed offer and a settlement to read"
(around line 137).

Today it reads `/settlements?limit=1` and takes both the agent and the slip hash from that newest row.
The newest settlement can legitimately carry no slip: a refunded held Hedera call (status `refunded`,
rail `hedera-scheduled`). The console takes its agent from the newest settlement
(`apps/web/src/lib/api.ts:370`), but it links the slip and verify screens only from rows that carry
a slip.

Change:

- Keep the `/settlements?limit=1` request and take `agent` from its first row, exactly as now.
- Add a second request through `ctx.http("settlements with slips", `${hub}/settlements?limit=20`)`. It
  must answer 200. Take `slipHash` from the first row, in the order the hub returns them (newest first),
  that has a non-empty `slipHash`.
- Everything else is unchanged. If none of the 20 rows has a slip hash, the existing failure message
  "no settlement carries a slip hash to read (slip, verify)" still applies.

## 2. hedera-held-undelivered (21b): find the agent's expired entry on the topic itself

File: `e2e/flows/hedera-held.flow.ts`, the step "the call fails, the hold expires unexecuted, and the
agent releases it", and the later HCS step.

Today the step requires the agent's evidence to carry an `expired log` label with a sequence. The
agent script reads the topic right after appending its `expired` entry, before the mirror has
indexed it, so the label can be missing even though the entry exists.

Change:

- Remove the requirement that the evidence carries `expired log`. If it does carry one (`#<n>`), use
  that sequence.
- Otherwise find the entry yourself. Poll the mirror, every 3 s for up to 180 s, at
  `mirrorGet(`/api/v1/topics/${topicId}/messages?sequencenumber=gt:${logSequence}&order=asc&limit=50`)`.
  `logSequence` is the hold log sequence from the evidence. Decode each message as `lib/hedera.ts`
  does: base64, then JSON. Take the first message whose JSON has `kind === "expired"` and
  `schedule === scheduleId`. Its sequence is `expiredSequence`. Not found after 180 s fails with
  "no expired entry for <scheduleId> on the topic after #<logSequence>".
- The HCS step is unchanged: it reads `topicMessage(topicId, expiredSequence)` and still requires kind
  `expired`, the schedule, the create tx and the agent as payer.
- Every other check in the step stays: `hub answer` not 200, `executed` none, `release` released, the
  balance equal before and after.

## 3. mpp (19): wait until the demo server answers

File: `e2e/flows/mpp.flow.ts`, the step "demo server up on the mpp rail".

`scripts/mpp/server.ts` prints its ready line before it calls `Bun.serve`. On a loaded machine the
port starts listening seconds after the line. The next step then fails with "Unable to connect".

Change:

- After the existing `waitFor` of the ready line and its `check`, poll
  `fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(2000) })` every 250 ms for up to 30 s.
  Stop at the first response with status 200. A thrown fetch (connection refused, timeout) means try
  again.
- If no 200 arrives within 30 s, fail the step with "the mpp demo server printed ready but did not
  answer within 30 s".
- Do not change the server script. That is cs-hd's file; the lane reports it separately.

## Gate (paste the tails in your report)

1. `bun run typecheck` clean.
2. `bun test e2e/test` all pass.
3. `bun run e2e -- --list` lists every flow, as before.

## Constraints

- **No browser of any kind on this machine:** no headless Chrome, Playwright, Puppeteer or screenshot
  tools.
- Do not run any flow (`bun run e2e` without `--list`). Flows move real testnet funds and read keys.
  The lane runs them after review.
- Touch only `e2e/flows/production.flow.ts`, `e2e/flows/hedera-held.flow.ts` and `e2e/flows/mpp.flow.ts`.
  Never read, print or log a key.
- Never push, merge or deploy. Commit on `cs/cs-61` in three small present-tense commits, one per fix.
  No emoji, no Co-authored-by and no other trailers.
- If something cannot be done as written, stop and say exactly what and why in your report. Do not
  substitute another mechanism.

## Report

`.packets/reports/cs-61-e2e-fixes.md`: each change and its line range, and the gate outputs.
