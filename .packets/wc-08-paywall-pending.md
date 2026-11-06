# wc-08: the paywall keeps a pending payment claimed

Issue: #14, the drop-in. This packet is cs-w1's should-fix from `reports/review-7cee602.md` (in `$M/reports/`).

## Goal

`whitechainPaywall` claims each payment (`from:nonce`) before it serves. When a settle answers `settlement_pending`, the transaction may still land, but the paywall currently releases the claim. The same payment can then be presented again and the handler runs a second time. The relay's `replayed` refusal already stops a second response, but the handler must not run twice either.

Keep a pending payment claimed until the chain could no longer settle it.

## Lease

- `packages/relay/src/paywall.ts` (change 1-4), plus the files item 5 names
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

5. **Refund reasons.** The merchant view's partial-refund panel asks for a reason, so the ledger has to keep it. Add these files to the lease: `packages/relay/src/{refund,ledger,server,merchant-server,escrow-ops}.ts` and their tests.
   - **Accepted values:** `requested_by_customer`, `duplicate`, `not_delivered` or `other`. Anything else is refused as `invalid_payload`. The field is optional everywhere.
   - **Merchant server:** `POST /orders/:id/refund` accepts `{ amount?, reason? }` and passes `reason` on to the relay's `/refund` or `/escrow/cancel`.
   - **Relay:** `/refund` and `/escrow/cancel` accept `reason`.
   - **Ledger:** the `refunds` table gets a nullable `reason` column, and jobs get `close_reason` for a cancel. Add both with `ALTER TABLE` only when missing.
   - **Orders:** `/orders/:id` returns each refund's `reason` and the order's `closeReason`.
   - **Timeline fields (read only):** the merchant view's timeline needs three facts the ledger already has or can record.
     - The `refunds` table gets a nullable `created_at` (ms), set on insert and added with `ALTER TABLE` only when missing. `/orders/:id` returns it as each refund's `at`, or `null` for older rows.
     - Escrow orders carry `slipHash` (the job's `slip_hash`) and `closedAt` (the job's `closed_at`) in both `/orders` and `/orders/:id`.
     - Direct payments carry `slipHash: null` and `closedAt: null`.
   - **CSV:** the orders CSV gets a final `refund_reasons` column, space-joined.
   - **Tests:** a reason round-trips on refund and on cancel, and a bad reason is refused.

6. **An open escrow is cancelled whole or not at all** (cs-w1 should-fix 2 on PR #83, review 5aab25b; repeated on PR #114, review a128e39). This is `merchant-server.ts`, `POST /orders/:id/refund`, for an escrow order whose status is `held` or `in_review`.
   - **Exact amount:** proceed only when `amount` equals the order's full `amount` (atomic, compared as BigInt). Then `signCancel` → `/escrow/cancel`, as today.
   - **Any other amount:** 400 `{ ok: false, reason: "partial_cancel_not_possible" }`, and nothing is signed.
   - **No amount:** keep accepting it, for older consoles.
   - **In review:** an `in_review` order (escrow v2, delivered with the review window running) takes the same path as `held`. The payee may cancel it, and the whole amount goes back.
   - **Test:** a held order refunded with half its amount is refused with that reason, and no cancel reaches the relay. The same holds for an `in_review` order.

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

Write `$M/reports/wc-08-paywall-pending.md`.
