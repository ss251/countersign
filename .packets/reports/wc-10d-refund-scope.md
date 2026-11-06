# wc-10d — a refund signature names the payment it refunds

Issue: #14. Implements STEER-2225 Fix 3, point 4, for the merchant's refunds. The `in_review` branch is untouched: point 5 stays for its own packet.

## What changed

### `packages/relay/src/merchant.ts`

- Added and exported `refundNonce(paymentId, refundedBefore)`. It returns
  `keccak256(encodeAbiParameters(parseAbiParameters("string, string, uint256"), ["countersign refund", paymentId, refundedBefore]))`, all from `viem`.
- `RefundPayment` gained `id?: string`.
- `signRefund` now sets the authorization nonce to `refundNonce(payment.id, payment.refunded)` when the payment has an id. Without an id it keeps the existing random 32-byte nonce, unchanged.

### `packages/relay/src/refund-client.ts`

- The `signRefund` call in `refundOrderWithStatus` passes `id: order.id`.

### `packages/relay/src/merchant-server.ts`

- The `signRefund` call in `POST /refund/:paymentId` passes `id: paymentId`.

Nothing in the relay changed. No existing test was edited. `bun.lock` was not changed or committed.

## New tests — `packages/relay/test/refund-scope.test.ts`

`refundNonce`:

- `is deterministic` — the same payment id and refunded amount produce the same nonce on two calls.
- `changes when the payment id changes` — two different payment ids produce different nonces at the same refunded amount.
- `changes when the amount already refunded changes` — the same payment id at `0n` and `1n` produces different nonces.
- `is a 32-byte hex string` — the result matches `0x` followed by 64 hex digits.

`signRefund nonce`:

- `names the payment and the amount already refunded when the payment has an id` — `authorization.nonce` equals `refundNonce(PAYMENT_ID, 500_000n)` exactly.
- `stays random when the payment has no id` — two consecutive signatures over the same payment give different nonces, so the old behavior is preserved.

Merchant service, against the real test relay app:

- `POST /orders/:id/refund names the order and its refunded amount` — a paid order refunds successfully and the `transferWithAuthorization` write carries `refundNonce(order.id, 0n)` as its nonce, proving the posted authorization named the order.
- `a later partial refund names the amount already refunded` — a 500000 partial refund writes `refundNonce(id, 0n)`, then a follow-up refund writes `refundNonce(id, 500_000n)`, proving the nonce moves on as `refunded` moves on.
- `POST /refund/:paymentId names the payment id` — the direct payment route refunds successfully and the write carries `refundNonce(paymentId, 0n)`.

Together these prove the nonce is a pure function of the payment and its refunded-before amount, that both merchant entry points use it, and that the id-less path still behaves as before.

## Acceptance

```
bun install --linker hoisted
bun run typecheck
bun test
forge test
bun run --cwd apps/web build
```

All green:

- install: `Checked 857 installs across 668 packages (no changes)`
- typecheck: clean
- `bun test`: `1235 pass, 4 skip, 0 fail` (1239 tests across 148 files, 4589 `expect()` calls); the 9 new tests account for the increase from the previous 1226 passes
- `forge test`: 47 passed, 0 failed, 0 skipped (5 suites)
- web build: `vite v8.3.6`, 4974 modules transformed, built in 577 ms
