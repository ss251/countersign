# cs-14c-openai-blockers report

Date: 2026-11-06
Branch: `cs/cs-14c`

## Landed

### B18 — a revoke stops a running endpoint

`packages/buyer/src/openai/server.ts` now calls `state.loadEnvelope()` on every completion and
hands that envelope to `buy()`. The startup `envelope` argument is optional and only used when
the state directory holds no envelope, so the existing tests still construct a server directly.
`cli.ts openai` no longer passes a fixed envelope.

`w1-openai.test.ts` B18 passes: a completed request after `envelope set --revoke` answers 403
`envelope_refused` and the journal holds no `signed` entry.

### B19 — the client's model is the offer bought

In the fallback path, when `GET /offers` fails and the code takes `hub.getOffer(model)`, the
server now refuses a listing whose `offerHash` does not equal `model`, and `buy()` is called
with `offerHash: model` rather than the hub's listing hash. The model must also be a 32-byte
hex offer hash.

`w1-openai.test.ts` B19 passes: a hub whose list fails and that serves another offer for the
requested hash buys nothing.

### B20 — one completion is paid at most once

- The server sets `idleTimeout: 255` and calls `server.timeout(req, 0)` for completions, so the
  hub's 120 s wait cannot hit Bun's idle timeout.
- Once the journal shows a `signed` entry for the attempt, every failure is answered `409`
  `{error: {type: "payment_signed", jobId, message}}` with `x-should-retry: false`. The message
  names `cli.ts resume`. No 5xx and no dropped connection can follow a signature.
- A per-body answer cache, keyed by the SHA-256 of the raw request body, replays a completed
  success to a request carrying `x-stainless-retry-count` within 60 s, and always replays the
  `payment_signed` answer. Identical requests that arrive while one is still running await the
  first attempt instead of signing a second payment.
- Failures are classified by where `buy()` stopped, using the journal entries appended during
  the attempt, not by the hub's wording:
  - after a signature: the 409 above with its `jobId`;
  - local envelope refusal (`revoked`, `expired`, `not-allowlisted`, `over-cap`,
    `over-merchant-limit`, `held`, approval outcomes): 403 `envelope_refused`;
  - anything else before a signature: 402 `payment_refused`.

`w1-openai.test.ts` B20 passes: the truncated paid answer signs once, the default `openai`
client's retries cannot buy twice, and the journal holds one `signed` entry.

### Tests — `packages/buyer/test/openai.test.ts`

The fixture now saves the envelope into the state directory, as `cli.ts` does. Three tests were
added beside the original six:

1. a revoke saved after startup stops the next completion (403, no signature);
2. a failing list plus a hub that serves another offer for the requested hash buys nothing
   (404, empty journal);
3. a signed payment whose answer is lost answers 409 `payment_signed` with a `jobId` and the
   default client pays exactly once.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test packages/buyer && bun test && forge test
```

- `bun install`: no changes.
- `bun run typecheck`: clean.
- `bun test packages/buyer`: 147 pass, 0 fail.
- `bun test`: 956 pass, 3 skip, 0 fail.
- `forge test`: 47 pass, 0 fail.

No view code, no new dependencies, nothing outside the lease; the server binds to `127.0.0.1`
and never prints the token.
