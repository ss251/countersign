> Published copy of the build record. Local paths and machine names are replaced, the person directing the work is called the project lead, and lines about other work are removed. Everything else is as written during the event.

# Review d1fcf2a (cs/wc) — Whitechain relayer, x402 exact facilitator, refund, merchant server

Reviewer: cs-w1. Result: **blockers=2 should-fix=4**. Tests: `packages/relay/test/w1-attacks.test.ts` on `cs/w1` (commit after 3d142be). The 56 existing relay tests pass; the 2 new tests fail on this sha.

## Blockers (failing tests)
**B1. Merchant refund endpoint is unauthenticated** — `merchant-server.ts` `POST /refund/:paymentId` (CORS `*`, no credential). Anyone who can reach :8403 makes the merchant key sign a refund of the full remaining amount and the relay sends it. Payment ids are public (`GET /payments`, `/payments.csv` on the relay). A buyer who has received the goods can refund themselves; any web page can trigger it from the merchant's browser. Funds go back to the payer, so this is revenue loss and "service for free", not theft by a third party. Test: `W1 B1: ... an anonymous caller cannot make the merchant key sign and send a refund` expects 401/403 and no POST to the relay; gets 200 and a relay call. Fix: require a merchant session secret (bearer token from env) on the merchant routes and drop `origin: "*"` for the POST, or bind to localhost behind the web app's auth.

**B2. A pending refund does not reserve its amount** — `refund.ts` computes `remaining` from recorded refunds only, and `outcome.status === "pending"` records nothing. After a receipt timeout the tx may still land; a second click signs a fresh nonce, passes `refund_amount`, and broadcasts again. Both can mine: the merchant refunds twice the payment. Test: `W1 B2: ... after a refund times out pending, a second full refund is refused` expects one write, gets two. Fix: record a pending refund (like `recordPending` for payments) and subtract it from `refundable` until it is resolved or its authorisation expires.

## Should-fix
1. **Free gas for any payee.** `verifyExact` takes `payTo` from the caller's own requirements; the relayer sponsors a transfer to any address. Only the ceilings bound it. Allowlist merchant `payTo` (or a minimum value) so the hourly WBT budget cannot be burned by anyone with a few cents of USDT. Per-payer limits do not help: payers are free to mint.
2. **Ceiling resets on restart** (`SpendCeiling` is in memory). A crash loop or restart restores the full hourly budget. Seed it from the ledger or persist tickets.
3. **Zero-fee estimate disables the wei ceiling.** If `estimateFeesPerGas` returns `maxFeePerGas` undefined, `?? 0n` makes `worstCaseWei` 0, so only the tx-count ceiling applies, and the tx is sent at fee 0 or a chain default. Refuse when it is 0.
4. **Ledger is public and unscoped.** `/payments` lists everyone's payments with no filter required; `/payments/:id` exposes ids that B1 turns into refund handles. Fine for a demo; scope it before B1's fix is considered complete.

## Attacked, held
- Domain: `{Tether USD, 1, 1874}` with the USDT address; signature recovered before spending; `payTo`/value/validity checked; nonce state and simulation before send; ERC-3009 nonce burns on the token, so a replayed settle is refused (and `settleExact` is idempotent through the ledger).
- Refund binding: `from == payTo`, `to == payer`, `0 < value <= refundable`, signature recovered, nonce unused, simulated; serial queue (`exclusive`) with a re-check inside the lock, so two concurrent full refunds cannot both pass (tested by the existing suite).
- Relayer: token allowlist, simulate before send, fee cap, balance floor, serial queue; the cap, tx and per-payer counts are reserved before the send and released on a failed send.
- Amounts: atomic bigint end to end; `parseAtomic` is strict.
- Scripts: no key printed in the files read (`vm.env*` only).

## Not reviewed
- Deployment scripts beyond a grep for key handling; the escrow scheme (wc-02) — separate REVIEW-REQ.
