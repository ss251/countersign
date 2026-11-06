# wc-10d: a refund signature names the payment it refunds

Issue: #14. This implements STEER-2225 Fix 3, point 4, for the merchant's refunds. cs-phone found the gap while building the merchant screen on `refundOrder`.

**Not in this packet:** what happens to `in_review` orders (point 5). It changes an existing test, so it waits for the captain's ruling on cs-phone's 17:43:20Z NEEDS-CAPTAIN and goes in its own packet. Leave the `in_review` branch exactly as it is.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `cs/wc-10b` as wc-10c leaves it. You run in the same worktree, after wc-10c.

## What happens now

- `signRefund` (`packages/relay/src/merchant.ts`) signs an EIP-3009 authorization with a random nonce. The typed data names the merchant, the customer, the value and the validity, but not the payment it refunds.
- Two clicks also make two different signatures for the same refund.

## Decision: the refund nonce names its payment (`merchant.ts`)
- **Add and export:**

  ```ts
  refundNonce(paymentId: string, refundedBefore: bigint): Hex
  ```

  It returns `keccak256(encodeAbiParameters(parseAbiParameters("string, string, uint256"), ["countersign refund", paymentId, refundedBefore]))`, all from viem.
- **`SignRefundInput.payment` gains an optional `id?: string`:**
  - with `id`: the nonce is `refundNonce(payment.id, payment.refunded)`;
  - without `id`: the random nonce, unchanged.
- **The callers pass the id:**
  - `refundOrder` passes `id: order.id`;
  - `merchant-server.ts`'s `POST /refund/:paymentId` passes `id: paymentId`.
- **Why this is enough without a relay change:** the token accepts each nonce once per merchant. Two signatures for the same payment and the same refunded amount share a nonce, so at most one of them settles. After a refund, `refunded` moves on, and the next partial refund gets a fresh nonce.
- **Nothing in the relay changes.**

## Tests (no network)

1. **`refundNonce`:**
   - it is deterministic;
   - it changes when the payment id changes, and when `refundedBefore` changes;
   - it is a 32-byte hex string.
2. **`signRefund`:**
   - with `payment.id`, `authorization.nonce` equals `refundNonce(id, refunded)`;
   - without it, two calls give different nonces.
3. **The merchant service:**
   - `POST /orders/:id/refund` for a paid order posts an authorization whose nonce is `refundNonce(order.id, refunded)`;
   - `POST /refund/:paymentId` does the same with `paymentId`.
4. **Existing tests:** every existing test passes **unedited**.

## Lease

- `packages/relay/src/merchant.ts`
- `packages/relay/src/refund-client.ts`: the `signRefund` call only.
- `packages/relay/src/merchant-server.ts`: the `signRefund` call in `POST /refund/:paymentId` only.
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
bun install --linker hoisted && bun run typecheck && bun test && forge test && bun run --cwd apps/web build
```

All green.

## Stop conditions

Stop if any of these happens:
- a change is needed outside the lease;
- a failure survives three different fixes;
- 25 minutes have passed.

## Report

Write `.packets/reports/wc-10d-refund-scope.md` in your worktree and commit it, saying what changed and what each new test proves.
