# wc-08: the paywall keeps a pending payment claimed

Issue: #14, the drop-in. This packet is cs-w1's should-fix from `reports/review-7cee602.md` (in `/Users/thescoho/Developer/countersign-mumbai/reports/`).

## Goal

`whitechainPaywall` claims each payment (`from:nonce`) before it serves. When a settle answers `settlement_pending`, the transaction may still land, but the paywall currently releases the claim. The same payment can then be presented again and the handler runs a second time. The relay's `replayed` refusal already stops a second response, but the handler must not run twice either.

Keep a pending payment claimed until the chain could no longer settle it.

## Lease

- `packages/relay/src/paywall.ts`
- `packages/relay/test/paywall.test.ts`

Touch nothing else, and no view code. Never commit `bun.lock`.

## What to build

1. **Keep the claim.** When settle answers `errorReason: "settlement_pending"`, the claim moves to `pending` with the transaction hash and the authorisation's `validBefore`. It is not released. The response stays as today: 402 with `"Refused. settlement_pending"` and the `PAYMENT-RESPONSE` header carrying the pending answer.
2. **Refuse while pending.** A new presentation of a pending claim gets 409 `{ error: "Refused. This payment is still settling." }`. The handler does not run.
3. **Let it expire.** A pending claim is released once `now > validBefore + 60`, because after `validBefore` the token itself refuses the authorisation. From then on the payment can be presented again.
4. **Tests:**
   - pending is refused, and the handler is not called;
   - after the window, the payment is accepted again;
   - a non-pending settle failure still releases the claim at once, as today.

## Constraints

- **No browser of any kind on this machine.** No headless Chrome, Playwright, Puppeteer or screenshot tools. Verify with tests only.
- No network in tests. Small present-tense commits ending `refs #14`, no emoji, no `Co-authored-by`. Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test
```

All green, including cs-w1's `packages/relay/test/w1-attacks.test.ts`.

## Stop conditions

Stop if a change is needed outside the lease, a failure survives three different fixes, or 40 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-08-paywall-pending.md`.
