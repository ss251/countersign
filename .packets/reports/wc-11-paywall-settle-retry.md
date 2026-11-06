# wc-11 paywall settle retry report

Date: 2026-11-06
Branch: `cs/wc-11`
Base: `origin/cs/int` (carries #231)

## What changed

`packages/relay/src/paywall.ts` only.

### `settlePayment` retries once and owns its replay

- New option `settleRetryDelayMs`, default `1000`.
- When the first `POST /settle` returns null (fetch throws or answers non-2xx), the paywall waits
  `settleRetryDelayMs` and posts the same request once more.
- A `replayed: true` answer after that retry means our own first settle landed. The claim is
  settled and the response is served with `PAYMENT-RESPONSE`.
- A `replayed: true` answer without a retry still gives 409 already used.
- If both settle calls return null and there is a claim, the claim is kept pending with no
  transaction and a fresh retry token. The answer is the normal 402
  `Refused. settlement_pending` with `PAYMENT-RETRY` and no `PAYMENT-RESPONSE`.
- If both calls return null and there is no claim, the answer remains 503 unreachable.
- `pendingClaim` now accepts a null transaction, matching the claim type.

### The `PAYMENT-RETRY` path settles a pending claim with no transaction

When a request presents the matching token for a pending claim whose `txHash` is null, the
paywall posts the same settle request once:

- `success: true` (replayed or not): re-read the claim, settle it if still pending, run the
  handler, and serve with `PAYMENT-RESPONSE`.
- `settlement_pending` with a transaction: store the `txHash` on the pending claim, keep the
  token, and answer still settling.
- Any other answer or null: answer still settling; the claim stays pending and expires as before.

A pending claim that already has a `txHash` still reads `/orders/<txHash>`.

## New tests

`packages/relay/test/paywall-settle-retry.test.ts`, using a fake facilitator and
`settleRetryDelayMs: 0`:

1. **A thrown settle reply is retried and the request is served.** First `/settle` throws, the
   second succeeds; the response is 200 with the handler body and `PAYMENT-RESPONSE`, and
   `/settle` ran twice.
2. **A 502 then a replay of our own retry is served.** The first answer is a 502, the second is
   `{ success: true, replayed: true, transaction }`; the response is 200 with the replayed
   settle body in `PAYMENT-RESPONSE`.
3. **A plain replay is still refused.** A first `replayed: true` gives 409 already used with one
   `/settle` call.
4. **Two lost replies leave a pending claim that the token serves.** The first request gets a
   402 with `PAYMENT-RETRY` and no `PAYMENT-RESPONSE`; a tokenless retry gets 409 still settling;
   a retry with the token gets 200 with the handler body.
5. **Settle before retries a thrown settle and runs the handler once.** The first `/settle`
   throws, the second succeeds; the handler ran exactly once and the response is 200.
6. **A token retry records a pending transaction and the next retry serves it.** The token retry
   receives `settlement_pending` with a transaction; the next token retry reads
   `/orders/<txHash>`, sees paid, and serves 200 with `PAYMENT-RESPONSE`.

The existing paywall tests pass unedited.

## Gate

```
bun install --linker hoisted   # no changes
bun run typecheck              # clean
bun test                       # 1430 pass, 5 skip, 0 fail
forge test                     # 47 pass, 0 fail
```
