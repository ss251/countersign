> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review f06bf3e (cs/cs-14, #53): the buyer's OpenAI-compatible endpoint, for landing

Reviewer: cs-w1. Result: **blockers=3 should-fix=1**.

Tests: `packages/buyer/test/w1-openai.test.ts` on cs/w1 (e424cb6). On f06bf3e with only that file added, `packages/buyer` gives 74 pass and 3 fail: B18, B19 and B20. cs-14's own `openai.test.ts` passes, 6/0. Each fix is a few lines.

## Blockers
**B18. A running endpoint keeps spending after the human revokes.**
- `cli.ts openai` passes `envelope: state.loadEnvelope()` once at startup, and `server.ts` reuses that object for every `buy()`.
- `envelope set --revoke` (or a lower cap, a narrower allowlist, or a new ask-above) writes the state file, but the running endpoint never reads it again, so only killing the process stops it. The revoke is the human's kill switch, and the charter names this case: a revoked envelope still spending.
- The test starts the endpoint as the CLI does, saves `revoked: true`, then runs a completion. Expected 403 and nothing signed; got 200 and paid.
- Fix: read the envelope from `state` on every completion (the server already holds `state`).

**B19. In the fallback lookup, the hub chooses which offer is bought.**
- When `GET /offers` fails, `chatCompletion` takes `deps.hub.getOffer(model)` and buys `listing.offerHash`, which it never compares with `model`.
- `buy()` then checks that the served offer hashes to the hub's own hash, not the one the client named. A hub can force the fallback with a 500 and route every completion to a seller of its choosing, within the envelope.
- The test: the list returns 500 and `/offers/<asked>` answers another offer. The endpoint bought the other offer.
- Fix: in the fallback, refuse unless `listing.offerHash` equals `model`, and call `buy` with `offerHash: model`.

**B20. A completion whose answer is lost is paid again by the client's own retries.**
- After `buy()` has signed, any failure that is not a `BuyError` becomes a 500, for example the hub's answer arriving broken or the connection dropping. The official OpenAI client retries a 5xx or a connection error twice by default, and each retry is a new `buy()` with a fresh salt, so a new payment.
- Bun's default `idleTimeout` of 10 s also cuts any completion slower than 10 s (the hub waits up to 120 s for a seller), which the client retries the same way.
- The test: the paid call's answer arrives broken, and the default client is used. Expected one payment; got three.
- Fix:
  - Once a payment has been signed, never answer with a retryable status. Answer 409 or 502 with the `jobId`, and point the caller to `resume`.
  - Raise `idleTimeout` (or call `server.timeout(req, 0)` for completions).
  - Optionally, return the earlier result to a retry (the client marks one with `x-stainless-retry-count`) for the same request body within a short window.

## Should-fix
1. **Failures after payment come back as refusals.**
   - Post-signing hub errors ("failed-delivery", "release-failed") map to 402 `payment_refused`, which reads like nothing was paid.
   - Any hub message starting "Refused." with budget, limit, allowlist, revoked or expired in it becomes 403 `envelope_refused`, even though the local envelope approved.
   - Fix: classify by where `buy()` stopped, not by the hub's words. Report a signed payment with its `jobId`.

## Held
- **Bind:** `127.0.0.1` by default, with no host flag in the CLI.
- **Bearer check:** both sides are hashed, then compared in constant time. Authentication runs before routing and before the body is parsed, for every method, so a cross-site `text/plain` POST or a preflight gets 401.
- **Token file:** 0600 and never printed; the CLI prints only its path.
- **What a request can choose:** only `model`, `messages` and `stream` are read. Approvals are fixed to `"local"`, `approve` is never passed, and the clock and the hub are the server's own.
- **Limits:** cap, per-merchant limit and allowlist are enforced inside `buy()` under the journal lock.
- **Success:** a 200 is built only from a slip `buy()` has verified.
