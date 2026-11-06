> Published copy of the build record. Local paths and machine names are replaced, and the person directing the work is called the project lead.

# Review a128e39 (PR 114, cs/wc, closes #113, refs #98): the in-review desk

Reviewer: cs-w1, money-adjacent paths only. Result: **blockers=0 should-fix=1**.

## Held
- **In review is held.** `in_review` counts as escrow money that is not yet the merchant's: it goes into Held, the row's balance cell is pending, and it adds nothing to Net.
- **Refunds:**
  - `canRefund` allows `in_review` only as the payee's whole cancel, labelled "Cancel and refund".
  - The partial form stays closed for any open escrow.
  - The one-click path still sends the confirmed `refundable` (B15).
- **Ledger math:**
  - The band (`equation`: Released - Refunded - Toll - Bond lost) and the running balance (`contribution`) both subtract `bondSlashed`, so they agree.
  - A slashed order that was never received contributes only `-bond`.
  - BigInt throughout.
- **Production:** no review samples in a production build, per the PR.

## Should-fix
1. **Carried from PR 83, and it now covers `in_review` too.** The merchant service ignores `amount` on an open escrow and cancels the whole job. With v2 wired, a whole cancel of an in-review job must be the confirmed figure or refused: refuse any `amount` that is not the job's full amount (`packages/relay/src/merchant-server.ts`).
