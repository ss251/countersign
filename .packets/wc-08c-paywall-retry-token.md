# wc-08c: only the original payer's retry is served

Issue: #14. This is the corrective for wc-08b (`8303944`), found by cs-wc in review.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

## The flaw in wc-08b

wc-08b serves a landed pending payment to any retry that presents the same `from:nonce`. The signed authorisation becomes public the moment the relay broadcasts it: its nonce, signature and fields are all in the `transferWithAuthorization` calldata. So anyone who watches the chain can rebuild the payment payload and be served first, and the payer who paid then gets "already used". Before wc-08b, both were refused.

## Decisions

### `packages/relay/src/paywall.ts`

1. **The header.** Export `PAYMENT_RETRY_HEADER = "PAYMENT-RETRY"`.
2. **Issue a token on a pending answer.** The `Claim` type gains `retryToken: string | null`. In the `settlement_pending` branch, create the token as 16 random bytes from `crypto.getRandomValues`, hex-encoded, and store it in the pending claim. Set it on that 402 response as `PAYMENT-RETRY: <token>`, next to the existing `PAYMENT-RESPONSE` header. This response goes only to the requester who sent the payment, so only that requester ever holds the token.
3. **Serve only with the token.** When a presented authorisation maps to a `pending` claim:
   - **The token is missing,** or does not equal `retryToken`: answer 409 still settling at once, with no order lookup. Compare in constant time: `timingSafeEqual` on equal-length buffers, and a length mismatch means unequal.
   - **The token matches:** do exactly what wc-08b does (look up, re-read the claim, settle it, run the handler, set `PAYMENT-RESPONSE`).
4. **Nothing else changes.** The pending claim's expiry and every other path stay as they are.

### `packages/relay/src/pay-fetch.ts` (`createPayFetch`)

5. **Retry the same payment with the token.**
   - **When to retry:** the paid request's answer (`second`) is a 402 that carries `PAYMENT-RETRY`.
   - **How:** retry up to 3 times. Before each retry, wait `retryDelayMs`: a new option, default 2000. For tests, a new option `sleep?: (ms: number) => Promise<void>` defaults to a `setTimeout` promise. Resend the same request with the same signed payment header, plus `PAYMENT-RETRY: <token>`.
   - **On a 200:** stop, and build the receipt from its `PAYMENT-RESPONSE`, exactly as for a first-time 200.
   - **On a 409:** keep waiting, up to the 3 tries.
   - **On any other answer:** stop and return it.
   - **After 3 tries:** return the last answer.
   - **Never** sign a second authorisation within one call. The spend reservation stays as it is.

## Lease

- `packages/relay/src/paywall.ts` and `packages/relay/src/pay-fetch.ts`;
- `packages/relay/test/paywall.test.ts` and `packages/relay/test/pay-fetch.test.ts`.

Touch nothing else, and no view code. Never commit `bun.lock`.

## Tests (no network)

1. **The token is issued.** A `settlement_pending` answer carries a `PAYMENT-RETRY` token.
2. **No token, no service.** A retry without the token, or with a wrong one of either length, gets 409. The order lookup is never called, and neither is the handler.
3. **The chain observer.** After the payment lands, the identical payload without the token gets 409 and is not served. The payer's retry with the token is then served once.
4. **The payer is served once.** A retry with the token after the payment lands is served once, and a further presentation gets 409 already used.
5. **The client retries, not re-signs.** `createPayFetch` gets a pending 402 with a token, then a 200. It retries with the same signature and the token, signs exactly once, and returns the 200 with its receipt.
6. **The client stops.** `createPayFetch` gets a pending 402 with a token, then three 409s. It stops after 3 retries and returns the last 409, having signed exactly once.
7. **Existing tests.** All existing paywall and pay-fetch tests still pass, including wc-08's and wc-08b's.

## Constraints

- **No browser** of any kind on this machine.
- **No network** in tests.
- **Commits:** small, present tense, ending `refs #14`, with no emoji and no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 30 minutes have passed.

## Report

Write `$M/reports/wc-08c-paywall-retry-token.md`.
