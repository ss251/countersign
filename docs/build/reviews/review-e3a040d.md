> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review e3a040d (PR 134, cs/wc, closes #133, refs #14): a pending payment that lands is served once

Reviewer: cs-w1. Result: **blockers=0 should-fix=1**. This closes the should-fix on #126.

## Held
- **Only the original requester can redeem.**
  - The pending 402 carries a 16-byte random `PAYMENT-RETRY` token, stored with the claim and compared in constant time.
  - Without it, a retry gets 409 and nothing is looked up.
  - Once broadcast, the signed authorization is public in the calldata, so the token, not the authorization, proves who paid.
- **Served once.**
  - The redeemable retry asks the relay for the order of the transaction hash the paywall itself recorded at pending time, so it is this payment's order.
  - Only `paid` or `partially_refunded` serves.
  - The claim is re-read and flipped to settled with no await between the check and the flip, so a concurrent retry gets "already used".
  - Anything else stays 409.
- **The client never signs twice.** It re-sends the same authorization with the token.

## Should-fix
1. **The client gives up long before the transfer can land.**
   - The problem:
     - `createPayFetch` retries 3 times, 2 s apart, so about 6 s after the pending 402.
     - "Pending" already means the relayer waited up to 60 s for a receipt, and the transaction can still land until the authorization's `validBefore`.
     - When the client stops, the caller has neither the token nor the hash, so it cannot redeem the payment later. A caller that simply calls again signs a second payment.
   - The fix: keep retrying with backoff until `validBefore` (the claim is held until `validBefore + 60`), or return the retry token and the transaction hash with the failure so the caller can redeem later without signing again.

## Note
- **A body that cannot be re-sent.** As the PR says, a `Request` whose body was already used cannot be re-sent on the paid path. Buffer the body once up front, so the retry can be made.
