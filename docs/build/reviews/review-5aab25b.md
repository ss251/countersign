> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review 5aab25b (PR 83, cs/wc, #32): merchant desk, live reads and refund gating

Reviewer: cs-w1. Result: **blockers=1 should-fix=4**.

- Test: `W1 B15` in `apps/web/test/w1-merchant.test.ts` on cs/w1 (ec9347e). It fails, and `apps/web/test/merchant.test.ts` passes (60/0).
- 01c03c0..c145b46..5aab25b changes display only, as stated.

## Blocker
**B15. The one-click refund signs an amount the merchant never saw.**

The problem:
- `sendRefund` (Desk.tsx) shows "Refund <order.refundable>", waits out the undo window, then calls `refundOrder(order.id)` with no amount.
- The merchant service then signs whatever its relay says is left (`merchant-server.ts`: `signRefund` with `amount` undefined refunds `amount - refunded`). For a held escrow it cancels the whole job.
- The figure the merchant confirmed comes from whichever hub this console reads, and `?hub=` on any console link is remembered. The money comes from the relay. When the two differ, the console signs a refund nobody confirmed. Stale, buggy or hostile hub data is enough.

Scenario: a customer who paid 500 USDT sends the merchant a console link that names a lookalike hub. That hub lists the order as 0.01. The merchant, unlocked, clicks "Refund 0.01". 500 USDT goes back.

The test: after `unlockRefunds`, the call the desk makes, `refundOrder("0x01")`, posts a refund body with no `amount`.

The fix:
- Make `amount` required in `refundOrder`, and pass `BigInt(order.refundable)` from the one-click path.
- The service already refuses more than the remainder, so the signed figure can then only be the confirmed one or less.

## Should-fix
1. **A pending refund, or one whose outcome is unknown, is shown as "Refused", and the desk offers it again.**
   - The relay answers HTTP 200 `{ok: false, reason: "settlement_pending"}` when the relayer's receipt wait fails. `normalizeRefundReply` turns that into a refusal.
   - The hosted proxy gives up at 30 s while the relayer waits up to 60 s, so a slow refund comes back as a 502 "refusal".
   - In both cases the form stays ready. A resubmitted partial is a fresh authorization that still fits the remainder, so the customer can be refunded twice.
   - Fix: show pending or unknown as "may have gone through". Re-read the order before allowing another refund, and never treat a 5xx or `settlement_pending` as refused.
2. **A partial `amount` on a held escrow cancels the whole job.** `merchant-server.ts` signs a full `cancel` for `status === "held"` and ignores `amount`. Relay records give held jobs a refundable of 0, so only a hub record that calls a held job "paid" reaches this path. Refuse an `amount` on a held escrow. (This is server code, unchanged in this PR.)
3. **Hub orders are not checked against this ledger's merchant.** `fetchOrders` keeps every record `fromHubOrder` parses. Another seller's orders, or invented ones, flow into Released, Toll and Net, the running balance and the accountant export. The service refuses refunds on them (`not_your_order`), so the damage is to the statement. Drop records whose merchant is not the ledger's.
4. **A partial refund can remove the Undo of a pending full refund.**
   - `refundPart` never marks the row as sending, and it overwrites the row with "done" when it returns.
   - If a one-click refund was started meanwhile, its Undo disappears but its timer still fires.
   - Fix: mark the row as sending before the await, and refuse while an undo timer holds the order.

## Notes
- **`offersRefund` compares against the refundable captured at click time.** A stale list offers the just-refunded remainder again; the service refuses it.
- **`undoRefund` clears the row even after the timer has fired**, so a last-instant Undo looks accepted when it was not.
- **A 200 with no `orders` array reads as "No payments yet"**, with Net at 0.
- **Changing only the query keeps the desk mounted.** After switching from `?hub=off` to live, sample rows stay on screen until the first live read, and some sample ids are real Sepolia orders.

## Held
- **Server:** the token is compared timing-safe and the service fails closed without one. Ownership is checked three ways. The amount is capped at the remainder, then capped again under the relayer lock. Double clicks and two tabs cannot refund the same money twice.
- **Partial amounts:** `checkRefundAmount` is BigInt-only. It rejects `1e-6`, commas, signs, more than 6 decimals, 0, and anything above the remainder. The form posts exactly the atomic amount it shows.
- **The token:** it lives in a module variable, goes only to `MERCHANT_URL`, never to storage, the URL, a read or the hub, and is kept only after the service answers 200 to it.
- **Ledger math:** BigInt throughout, and Net = released - refunded - toll, with held money excluded. Fixtures load only on `?hub=off`, by dynamic import.
