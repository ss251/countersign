# wc-10 — the merchant console's checkout runs on our own drop-in

Issue: #14. Implements cs-wc's part of STEER-2210's amendment.

## What changed

### A. Browser-safe entry

- `packages/relay/src/headers.ts` (new) owns `PAYMENT_RETRY_HEADER`. `paywall.ts` imports and
  re-exports it, so existing imports keep working; `pay-fetch.ts` imports it from `headers.ts` and
  no longer loads `paywall.ts` (node:crypto + Hono).
- `merchant.ts` builds the refund nonce with `crypto.getRandomValues(new Uint8Array(32))` and
  viem's `toHex`, replacing `randomBytes` from `node:crypto`.
- `packages/relay/src/browser.ts` (new) re-exports `chain.ts`, `eip3009.ts`, `headers.ts`,
  `createPayFetch` / `PaidResponse` / `SpendLimitError` and their types, `signRefund` / `signCancel`,
  and `refundOrder` / `walletAccount` with their types.
- `packages/relay/package.json` gains `"./browser": "./src/browser.ts"`; nothing else changed.

### B. One refund path

- `packages/relay/src/refund-client.ts` (new):
  - `walletAccount(address, signTypedData)` is a viem `toAccount` local account that signs typed
    data only; `signMessage` and `signTransaction` throw
    `only typed-data signatures are supported`.
  - `refundOrder` refuses another merchant's order, cancels a held/in_review escrow order only for
    its whole amount, refunds a paid/partially refunded order through `signRefund`, and answers
    `not_refundable` otherwise. Relay replies are returned as parsed JSON; a thrown fetch, a 5xx or
    a non-JSON body becomes `{ ok: "unknown", reason: "The refund may have been sent. ..." }`.
- `merchant-server.ts`'s `POST /orders/:id/refund` keeps its token check and order lookup, then
  calls `refundOrder`. Relay-side replies (including `merchant_balance_low`) still answer 200;
  `not_your_order` is 403, `partial_cancel_not_possible` / `refund_not_possible` are 400,
  `not_refundable` is 409, and an unknown reply is 502.

### C. The twenty-line snippet

- `examples/whitechain/checkout-merchant.ts` and `checkout-customer.ts` hold the two files exactly
  as specified (13 non-empty lines together).
- `apps/web/server.ts` imports `checkout` from `examples/whitechain/checkout-merchant.ts`.

### D. The console's checkout

- `apps/web/server.ts` serves `/checkout/` through a small Hono app. `/checkout/sticker-pack` is
  priced at 0.01 USDT via `WC_MERCHANT_ADDRESS` and `RELAY_URL`, and answers an 8-character base32
  code from `crypto.getRandomValues` plus an ISO issue time. With either env unset, or the address
  invalid, every `/checkout/*` answers 503 `{ code: "no-checkout", message: ... }`.
- `apps/web/deploy.sh` stages `bun build apps/web/server.ts --target bun` as `server.js`; the
  Dockerfile copies and runs `server.js`. The bundle was also run from an empty directory with no
  `node_modules` and answered the unpaid checkout with 402.

### E. Relayer panel funding

- `packages/relay/src/server.ts` reads the escrow's `treasury()` and `FeeSplit.payees()` at startup,
  plus `tollBps`. `GET /status` gains `funding` with `feeSplit`, `payees` `[{ address, shareBps }]`,
  `relayerShareBps`, `tollBps`, and `feeSplitUsdt` read through a 30-second cache. A failed startup
  read leaves `funding: null`; every existing field is unchanged.

### F. Live fixture

- `examples/whitechain/checkout.live.test.ts` is skipped unless `LIVE_WHITECHAIN=1`; it needs
  `RELAY_URL`, `WC_MERCHANT_ADDRESS`, `WC_BUYER_PRIVATE_KEY` and `WC_MERCHANT_PRIVATE_KEY`, serves
  the snippet on a free local port, buys, checks the chain-1874 receipt, loads the order, refunds
  through `refundOrder`, and checks the refund receipt. It never logs a key.

## Tests added

- `packages/relay/test/browser.test.ts`: browser build, static value-import walk (no `node:`,
  `bun:` or `hono`), `walletAccount` signing and refusals.
- `packages/relay/test/refund-client.test.ts`: whole-amount escrow cancel, partial-cancel refusal,
  paid and partial refunds, `not_your_order`, `not_refundable`, and network / 502 / non-JSON unknown
  replies.
- `packages/relay/test/funding.test.ts`: payees and shares, relayer share (and zero), balance cache,
  and `funding: null` when the startup read fails.
- `apps/web/test/checkout.test.ts`: snippet line count, the server's import, the 402 naming the
  merchant and 10000 atomic USDT, and the 503 without `WC_MERCHANT_ADDRESS`.

No existing test was edited.

## Deviations and notes

- `refund-client.ts` holds the Whitechain escrow address as a local constant instead of importing
  `whitechain-config.ts`. That module imports `@countersign/rail`, which pulls `node:` builtins into
  a browser bundle; the constant is the same address.
- Because the fixed `buy` snippet returns no status, the live fixture proves the 200 through the
  item body and a non-null receipt, then confirms the settle and refund transactions on chain.
- `merchant-server.ts` maps an unknown relay reply to 502; all other relay JSON keeps its 200.

## Final counts

- `bun install --linker hoisted`: no changes.
- `bun run typecheck`: clean.
- `bun test`: 1220 pass, 4 skip, 0 fail; 1224 tests across 145 files.
- `forge test`: 47 passed, 0 failed, 0 skipped across 5 suites.
- `bun run --cwd apps/web build`: built successfully.
- Full acceptance chain exit: 0.
