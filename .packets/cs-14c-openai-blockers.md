# cs-14c-openai-blockers: the OpenAI-compatible endpoint stops on a revoke, buys only the model named, and never charges twice (refs #53)

## Setup

Run `bun install` at the worktree root before anything else. You are on `cs/cs-14c`: `cs/int` with cs-14's own four commits (f06bf3e and its three parents beyond cs-13) replayed by cherry-pick -x, because cs/cs-14 was cut from the pre-squash approvals branch.

## The fixes are decided (cs-w1's review of f06bf3e, `reports/review-f06bf3e.md`, orch-cs)

First copy `packages/buyer/test/w1-openai.test.ts` from `origin/cs/w1` (e424cb6) unedited:

```
git show origin/cs/w1:packages/buyer/test/w1-openai.test.ts > packages/buyer/test/w1-openai.test.ts
```

Its B18, B19 and B20 tests fail on f06bf3e and must pass.

1. **B18: a revoke stops a running endpoint.**
   - `server.ts` reads the envelope from `state` on every completion, never once at startup.
   - The `cli.ts openai` startup no longer passes a fixed envelope.
2. **B19: the client's model is the offer bought.**
   - In the fallback path, when `GET /offers` fails and the code uses `hub.getOffer(model)`, refuse unless `listing.offerHash` equals `model`.
   - Call `buy` with `offerHash: model`.
3. **B20: one completion is paid at most once.**
   - Once `buy()` has signed a payment, never answer with a retryable status (5xx, or a dropped connection). Answer `409` with `{error: {type: "payment_signed", jobId, message}}`, where the message points to `cli.ts resume`.
   - Raise the server's idle timeout for completions: `server.timeout(req, 0)`, or `idleTimeout` at least 150 s, because the hub waits up to 120 s.
   - Optionally, within 60 s, return the earlier result to a retry of the same request body (`x-stainless-retry-count`).
4. **The should-fix.** Classify failures by where `buy()` stopped, not by the hub's words.
   - **Before signing:** `402 payment_refused`, or `403 envelope_refused` when the local envelope refused.
   - **After signing:** the B20 answer, which carries the `jobId`.

## Lease

You may create or change only:

- `packages/buyer/src/openai/*`;
- `packages/buyer/src/cli.ts` (the `openai` command only);
- `packages/buyer/test/openai.test.ts` and `packages/buyer/test/w1-openai.test.ts`, the latter copied unedited;
- `.packets/reports/cs-14c-openai-blockers.md`.

## Tests

- **`w1-openai.test.ts`:** B18, B19 and B20 pass.
- **`openai.test.ts`:** its 6 pass, plus one test per fix: the revoke after startup, the fallback mismatch, and the signed-then-failed path answering 409 with the `jobId` and paying once under the default client's retries.
- Every existing buyer test passes.

## Constraints

- **Never launch a browser of any kind on this machine:** no Chrome or Chromium, headless or not, no Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- Bind only to `127.0.0.1`. Never print the token. Never deploy, never call a faucet, never use a public RPC in tests.
- No view code. TypeScript strict, no `any`. No new dependencies.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer && bun test && forge test
```

Every command passes.

## Stop conditions

- You need to edit outside the lease: stop and write the report.
- One problem has blocked you for more than 15 minutes: stop, commit what passes, and write the report.

## Finish

Commit with small present-tense messages ending `(refs #53)`, and no trailers. Write `.packets/reports/cs-14c-openai-blockers.md`. Do not push, merge or deploy.
