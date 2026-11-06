# wc-11: a paid request is served even when the relay's settle reply is lost

Issue: #14. Found by cs-wc in the live run on 2026-11-06 at 18:06Z:
- the buyer's payment settled on chain (`0x087656364e…`);
- the buyer got a one-key refusal body instead of the item;
- the merchant had to refund it.

The identical second run passed.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/int`, which carries #231.

## What happens now (`packages/relay/src/paywall.ts`)

1. **A lost reply is answered "unreachable".** When the `POST /settle` reply is lost (fetch throws, or a non-2xx answer), `settlePayment` releases the claim and answers 503 "The payment service is unreachable." But the relay may already have settled the payment.
2. **A retry is then refused.** If the buyer retries with the same authorization, the relay answers `{ success: true, replayed: true, transaction }`. Its settle is idempotent per (payer, nonce); see `exact.ts`. The paywall turns `replayed: true` into 409 "already used". The buyer has paid and can never be served.
3. **A pending claim without a transaction can never be served.** The `PAYMENT-RETRY` path serves a pending claim only when the claim has a `txHash`. Without one, it answers "still settling" forever.

## Decisions

### 1. `settlePayment` retries once and owns its replay

- **Add an option:** `settleRetryDelayMs?: number`, default 1000.
- **On the first `/settle`:** when `post(...)` returns null, wait `settleRetryDelayMs`, then `POST /settle` once more with the same request. Remember that this request retried.
- **`replayed: true` after this request's own retry:** treat it as settled. Call `settleClaim`, and return `{ kind: "settled", settle }`, so the handler's response is served with `PAYMENT-RESPONSE`.
- **`replayed: true` with no retry in this request:** unchanged; answer 409 already used.
- **Still null after the retry, with a claim:**
  - keep the claim as **pending**: `pendingClaim(key, validBefore, null, retryToken)`, with a fresh retry token;
  - answer exactly as the existing `settlement_pending` branch does: a 402 "Refused. settlement_pending" carrying the `PAYMENT-RETRY` header;
  - set no `PAYMENT-RESPONSE`, because there is no settle body.
- **Still null after the retry, with no claim** (`claimOf` returned null): unchanged; answer unreachable.
- **Everything else in `settlePayment` is unchanged.**

### 2. The `PAYMENT-RETRY` path settles a pending claim that has no transaction

This applies when a request presents the matching token for a pending claim whose `txHash` is null.

1. **Build the request** as the main path does: `{ x402Version: 2, paymentPayload: payment, paymentRequirements: requirements }`.
2. **`POST /settle` once.**
3. **Act on the answer:**

   | Answer | Action |
   |---|---|
   | `success: true`, replayed or not | Re-read the claim. If it is still pending, `settleClaim`, then `await next()`, then return `withSettle(c, settle)`. If it is no longer pending, answer already used. |
   | `settlement_pending` with a `transaction` | Store that `txHash` on the pending claim, keeping its token, and answer still settling. |
   | Anything else, or null | Answer still settling. The claim stays pending and expires as today. |

**A pending claim that has a `txHash`:** unchanged; it reads `/orders/<txHash>`.

## Tests (no network, a fake facilitator)

1. **Settle-after mode, a thrown first settle:** the first `/settle` throws and the second answers success. The response is 200 with the handler's body and `PAYMENT-RESPONSE`, and `/settle` was called twice.
2. **Settle-after mode, a 502 then a replay:** the first `/settle` answers 502 and the second answers `{ success: true, replayed: true, transaction }`. The response is 200, served.
3. **A plain replay is still refused:** a first `/settle` that answers `replayed: true` gives 409 already used, with `/settle` called once.
4. **Both calls fail, then the retry path:**
   - the first request gets a 402 with `PAYMENT-RETRY` and no `PAYMENT-RESPONSE`;
   - a retry with that token, where `/settle` answers success, gets 200 served;
   - a retry without the token gets 409 still settling.
5. **Settle-before mode:** the first `/settle` throws and the second answers success. The handler runs exactly once, and the response is 200.
6. **The retry path with a pending transaction:** a token retry where `/settle` answers `settlement_pending` with a transaction stores the `txHash`. The next token retry reads `/orders/<txHash>` and, on `paid`, serves.
7. **Existing tests:** every one passes **unedited**.

Use `settleRetryDelayMs: 0` in tests.

## Lease

- `packages/relay/src/paywall.ts`
- `packages/relay/test/*`: new tests only.

Touch nothing else. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind on this machine.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #14`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install --linker hoisted && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `.packets/reports/wc-11-paywall-settle-retry.md` in your worktree and commit it, saying what changed and what each new test proves.
