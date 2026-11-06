# wc-08b: a pending paywall payment that lands is served

Issue: #14, the drop-in. This packet is cs-w1's should-fix on PR #126, from `reports/review-82ccb68.md`.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

## The gap

When settle answers `settlement_pending`, the paywall keeps the `from:nonce` claim as `pending`, together with the transaction hash (wc-08). If that transaction then lands, the buyer has paid but is never served:
- a retry gets 409 "still settling";
- after `validBefore` + 60 the claim is released, and a retry is refused because the nonce is already used.

## Decisions

All in `packages/relay/src/paywall.ts`.

1. **Look the payment up.** When a presented authorisation maps to an existing claim in state `pending` that has a `txHash`, call `GET ${facilitator}/orders/${encodeURIComponent(txHash)}` before answering. The relay reconciles a pending payment with the chain on this route before it answers. A payment's id is its settle transaction hash.

2. **Act on the answer:**

   | The lookup answers | The paywall |
   |---|---|
   | 200 with `status` `"paid"` or `"partially_refunded"` | The payment landed: serve it (decision 3). |
   | 200 with `status` `"pending"` | 409 `{ error: "Refused. This payment is still settling." }`. The handler does not run. |
   | anything else: 404, another status (`"refunded"`, `"refund_pending"`, …), a non-JSON body, a network error, or no answer within 5 s (`AbortController`) | 409 still settling, as above. The claim keeps its expiry (`validBefore` + 60, unchanged). |

3. **Serving a landed payment.**
   - **After the lookup resolves,** read the claim again. If it is no longer `pending` (a concurrent retry already served it), answer 409 `ALREADY_USED`.
   - **Otherwise,** first set the claim to `settled`, with `validBefore` = `max(claim.validBefore, now + 60)` as `settleClaim` does.
   - **Then** run the handler (`await next()`) and set the `PAYMENT-RESPONSE` header on its response to `toBase64Json({ success: true, transaction: txHash, network: requirements.network, payer: <the authorisation's from> })`. This is the same shape as a settled answer.
   - **Both settle modes:** this path does the same thing in `"before"` and `"after"` mode, because the money has already moved, so settle is never called again.
   - **Handler errors:** a handler error here does not release the claim, because the payment landed. Answer the handler's error as the paywall already does for a settled payment.

4. **Nothing else changes.** Fresh payments, in-flight claims, settled claims and immediately failed settles behave exactly as today.

## Lease

- `packages/relay/src/paywall.ts`
- `packages/relay/test/paywall.test.ts`

Touch nothing else, and no view code. Never commit `bun.lock`.

## Tests (no network: a fake facilitator `fetch`, as the existing paywall tests use)

1. **Served once.** A payment stays pending, the lookup then answers `paid`, and a retry is served once: the handler is called, the `PAYMENT-RESPONSE` header decodes to `success: true` with the stored transaction, and a further presentation gets 409 already used.
2. **Still pending.** The lookup answers `pending`: 409 still settling, and the handler is not called.
3. **Lookup fails.** The lookup throws, answers 404 or answers 500: 409 still settling, and the handler is not called.
4. **Two retries at once.** Two concurrent retries after the payment lands: exactly one is served, and the other gets 409 already used.
5. **Refunded.** The lookup answers `refunded`: 409, and nothing is served.
6. **Existing tests.** All existing paywall tests still pass, including wc-08's pending, expiry and immediate-release tests.

## Constraints

- **No browser** of any kind on this machine. That means no headless Chrome, no Playwright, no Puppeteer and no screenshot tools.
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

Write `$M/reports/wc-08b-paywall-serve-landed.md`.
