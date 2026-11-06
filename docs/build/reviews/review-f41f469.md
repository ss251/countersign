> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review f41f469 (cs/cs-15, refs #19): the eip3009 rail, hub wiring and buyer payer

Reviewer: cs-w1. Result: **blockers=1 should-fix=2**.

- The blocker is inherited. f41f469 contains a5779b4 (cs-13), and `W1 B14` (`packages/buyer/test/w1-approval-replay.test.ts`, cs/w1 6eb0803) fails on f41f469 exactly as it does on a5779b4. cs-15 cannot land before the B14 fix in cs-13.
- The eip3009 diff (e06fe9b..f41f469) adds no new blocker.
- The eip3009 rail, hub and buyer tests give 18 pass, 0 fail, on anvil.

## Blocker
**B14 (from cs-13).** One signed approval clears more than one held call. See `review-a5779b4.md`.

## Should-fix
1. **A broadcast the hub cannot confirm becomes a 402 "Refused" with no record, though the money may already have moved.**
   - The problem:
     - `settle` returns `{success: false, errorReason: "pending", transaction: hash}` when the receipt wait times out.
     - It returns "would revert" when the authorization was already consumed. Anyone holding a TransferWithAuthorization can submit it, so a third party who sees the hub's transaction can submit it first; it still pays the seller.
     - In both cases `paidCall` answers 402 and never claims a job. On a direct rail the seller then holds the money, nothing is dispatched, there is no refund, and the buyer is told it was refused. A buyer that retries pays twice.
   - The fix:
     - Once `send` returns a hash, claim the job as pending with that settle tx before waiting for the receipt.
     - On a timeout or an "authorization is used" revert, read `authorizationState(from, nonce)` and the token's `AuthorizationUsed` / `Transfer` log.
     - If the transfer happened, dispatch, or answer "paid, unconfirmed" with the hash. Never answer 402 after a broadcast.
2. **The hub's relayer pays gas for every direct transfer, with no ceiling and no price floor, on the key that also funds escrow releases and refunds.**
   - A seller can list an offer at price `1` (0.000001 USDC) and buy it from itself repeatedly. Each call costs the hub a transfer's gas and costs the seller nothing.
   - The escrow rail already had this gap; eip3009 adds a second path to the same `CS_RELAYER_KEY`.
   - The fix: an hourly gas ceiling per payer and in total, as the Whitechain relay has; a minimum price for direct rails (the MPP floor is 0.01); and ideally a separate key, so a drained direct rail cannot stop escrow refunds.

## Notes
- **The jobs table is one namespace across rails.** On eip3009 the job id is the payer's own nonce. A payer who copies the nonce of an escrow job still being funded, and claims it first, makes the victim's call fail with `duplicate-payment`. The victim's escrow refunds at the deadline. Key jobs by rail, or derive the direct job id from `(from, nonce)`.
- **The payer signs its window from `ctx.now`, the start of the buy.** After an approval wait of up to 120 s, a hub offering a short `maxTimeoutSeconds` gets an authorization that "expires too soon". Read the clock at signing.

## Held
- **Rail verify:**
  - `to` must equal the hub's own `payTo`, and `value` must equal its amount, as an exact string.
  - The window requires `validAfter <= now`, `validBefore >= now + 6` and `validBefore <= now + maxTimeoutSeconds + 30`.
  - The signer must equal `from` under the configured USDC/2 domain, with chainId and verifyingContract.
  - `authorizationState` must be unused, and the balance must cover the value.
  - Unparseable windows and signatures are refused.
- **Rail settle:**
  - It re-verifies before sending.
  - Transactions go out through one queue, so the relayer's own nonces never collide.
  - It requires a success receipt and a `Transfer` log from the token for exactly `(from, to, value)`.
  - A high-s signature passes the recovery check but reverts at gas estimation, so no money moves.
- **Hub:**
  - Options match on scheme, network, asset, `payTo` and `extra.name`. A gateway payment cannot reach eip3009 or the reverse, and their signing domains differ anyway.
  - Verify and settle receive the hub's own entry, never `payment.accepted`.
  - Only rails the offer lists are offered.
  - A known nonce is refused before settle, and the job claim is atomic.
- **Cross-rail replay:** the escrow pulls with ReceiveWithAuthorization, which has a different typehash and only the escrow can call it. A direct TransferWithAuthorization cannot be replayed into the escrow, and an escrow authorization cannot be replayed into the direct rail.
- **Buyer:**
  - It signs only under the pinned USDC/2 domain on 5042002, never the entry's `extra`.
  - The amount must equal the offer price, and the payee must equal `offer.payTo.eip3009 ?? offer.seller`.
  - The window is at most 300 s.
  - A failure after signing keeps the reservation counted, so the envelope never undercounts.
- **Amounts:** at 6 decimals, `priceInToken` leaves the price unchanged. A token with other decimals would be scaled, and the buyer refuses any amount that is not the offer price, which is the safe direction.
