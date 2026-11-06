# wc-10: the merchant console's checkout runs on our own drop-in

Issue: #14 (the drop-in). This implements cs-wc's part of STEER-2210's amendment, the project lead's at about 22:15 IST:
- the merchant console serves its checkout through our own paywall and pay-fetch;
- the "integrate this in twenty lines" block shows the code the console actually runs;
- refunds go through one path;
- the relayer panel reads funding and guards from the live relay.

**Design: decided.** cs-wc wrote it on Opus. Implement it exactly as written. If something here cannot work, stop and report; do not choose another mechanism.

**Base:** `origin/cs/int`.

**Not in this packet:**
- the merchant screen (cs-phone, view code);
- escrow v2 (#198 and wc-09c).

## Decisions

### A. A browser-safe entry: `@countersign/relay/browser`

1. **The retry header gets its own module.** New `packages/relay/src/headers.ts` holds `export const PAYMENT_RETRY_HEADER = "PAYMENT-RETRY";`. `paywall.ts` imports it and re-exports it, so existing imports keep working. `pay-fetch.ts` imports it from `./headers.ts`, so it no longer loads `paywall.ts`, which imports `node:crypto` and Hono.
2. **`merchant.ts` uses Web Crypto.** It replaces `randomBytes` from `node:crypto` with `crypto.getRandomValues(new Uint8Array(32))`, hex-encoded with viem's `toHex`. The randomness is the same. Bun and browsers both provide it.
3. **The entry file.** New `packages/relay/src/browser.ts` re-exports only these:
   - `./chain.ts`
   - `./eip3009.ts`
   - `./headers.ts`
   - from `./pay-fetch.ts`: `createPayFetch`, `PaidResponse`, `SpendLimitError` and its types
   - from `./merchant.ts`: `signRefund` and `signCancel`
   - from `./refund-client.ts`: `refundOrder` and `walletAccount`
4. **The export.** In `packages/relay/package.json`, `exports` becomes `{ ".": "./src/index.ts", "./browser": "./src/browser.ts" }`. Change nothing else in that file.

### B. One refund path: `packages/relay/src/refund-client.ts`, which must be browser-safe

5. **`walletAccount(address: Address, signTypedData: (typedData) => Promise<Hex>): LocalAccount`.** It is built with viem's `toAccount`.
   - It signs typed data only.
   - `signMessage` and `signTransaction` throw `Error("only typed-data signatures are supported")`.
   - Purpose: a connected wallet (Privy or injected) becomes an account that `createPayFetch` and `refundOrder` accept.
6. **`refundOrder(input)`.** Its input is `{ relayUrl, merchant: LocalAccount, order, amount?: bigint, reason?: RefundReason, escrow?: Address, now?: () => number, fetch?: typeof fetch }`. The order is `{ id, kind, status, customer, merchant, amount, refunded, escrow? }`. It does exactly what `merchant-server.ts`'s `POST /orders/:id/refund` does today, after that route has loaded the order:
   - **`order.merchant` is not `merchant.address`:** `{ ok: false, reason: "not_your_order" }`.
   - **An escrow order that is `held` or `in_review`:**
     - an `amount` other than the full amount gives `{ ok: false, reason: "partial_cancel_not_possible" }`;
     - otherwise it calls `signCancel` with the escrow `order.escrow ?? escrow ?? WHITECHAIN_ESCROW`;
     - then it sends `POST ${relayUrl}/escrow/cancel` with `{ jobId: order.id, sellerSig, reason? }`.
   - **`paid` or `partially_refunded`:**
     - it calls `signRefund({ merchant, payment: { payer: customer, payTo: merchant, amount, refunded }, amount, now })`;
     - a throw gives `{ ok: false, reason: "refund_not_possible" }`;
     - otherwise it sends `POST ${relayUrl}/refund` with `{ paymentId: order.id, ...signed, reason? }`.
   - **Anything else:** `{ ok: false, reason: "not_refundable" }`.
   - **The relay's reply** is returned as parsed JSON. A thrown fetch, a 5xx or a non-JSON body returns `{ ok: "unknown", reason: "The refund may have been sent. Reload to see whether it settled before refunding again." }`.
7. **The merchant service uses it.** `merchant-server.ts`'s refund route keeps its token check and its order lookup, then calls `refundOrder` instead of its own branches. So the console and the merchant service refund through one function. Its existing tests pass **unedited**.

### C. The twenty-line snippet: `examples/whitechain/`

8. **The merchant side, `examples/whitechain/checkout-merchant.ts`:**

   ```ts
   import { whitechainPaywall } from "@countersign/relay";
   import type { Address } from "viem";

   // Charge 0.01 USDT on Whitechain for one route. The relay pays the gas.
   export const checkout = (payTo: Address, relay: string) =>
     whitechainPaywall({ price: "0.01", payTo, facilitator: relay, description: "countersign sticker pack" });
   ```

9. **The customer side, `examples/whitechain/checkout-customer.ts`:**

   ```ts
   import { createPayFetch } from "@countersign/relay/browser";
   import type { Address, LocalAccount } from "viem";

   // Pay the 402 from your wallet. You hold USDT only, never WBT.
   export async function buy(account: LocalAccount, url: string, merchant: Address) {
     const pay = createPayFetch({ account, maxPerCall: "0.10", payTo: [merchant] });
     const res = await pay(url);
     return { item: await res.json(), receipt: res.payment ?? null };
   }
   ```

10. **Both files are the code the console runs.** `apps/web/server.ts` imports `checkout` (decision D). The merchant screen imports `buy` and renders both files with Vite `?raw`; that is cs-phone's part. Keep both files exactly as above, apart from formatting the linter demands.

### D. The console serves its checkout through the snippet: `apps/web/server.ts`

11. **The route.** Requests under `/checkout/` go to a small Hono app created in `server.ts`, with one route:

    ```ts
    shop.get("/checkout/sticker-pack", checkout(payTo, relayUrl), (c) =>
      c.json({ item: "countersign sticker pack", code: <8 random base32 characters from crypto.getRandomValues>, issuedAt: <ISO time> }))
    ```

    - `payTo` comes from env `WC_MERCHANT_ADDRESS`, and `relayUrl` from the existing `RELAY_URL`.
    - When either is unset, or `WC_MERCHANT_ADDRESS` is not an address, `/checkout/*` answers 503 with `{ code: "no-checkout", message: "This console has no Whitechain checkout configured." }`, in the style of the proxy's existing `sentence()`.
    - Nothing else in `server.ts` changes.
12. **Deploy bundles the server**, because `server.ts` now imports Hono and the drop-in.
    - **`apps/web/deploy.sh`:** stage `bun build apps/web/server.ts --target bun --outfile <stage>/server.js` in place of copying `server.ts`.
    - **`apps/web/deploy/Dockerfile`:** `COPY server.js ./server.js`, and `CMD ["bun", "server.js"]`.
    - The image still needs no `node_modules`.

### E. The relayer panel's data: `packages/relay/src/server.ts` `/status`

13. **At startup**, read the escrow's `treasury()`, which is the FeeSplit, and `FeeSplit.payees()`, which returns `(address[], uint16[])`.
14. **`GET /status` gains `funding`:**
    - `feeSplit`: the FeeSplit's address;
    - `payees`: `[{ address, shareBps }]`;
    - `relayerShareBps`: the relayer address's share, or 0;
    - `tollBps`;
    - `feeSplitUsdt`: the FeeSplit's USDT balance in atomic units, read with a 30 s cache.

    A failed read at startup leaves `funding: null` and the relay starts anyway. Every existing `/status` field stays.

### F. The live fixture: `examples/whitechain/checkout.live.test.ts`

15. **When it runs.** It is skipped unless `LIVE_WHITECHAIN=1`. It needs `RELAY_URL` (the hosted relay), `WC_MERCHANT_ADDRESS`, `WC_BUYER_PRIVATE_KEY` and `WC_MERCHANT_PRIVATE_KEY`, all from env, and never logs a key.
16. **What it does:**
    1. serve `checkout` on a free local port;
    2. `buy` with the buyer key, then assert a 200 and a `receipt.transaction`, and that the transaction's receipt on chain 1874 has status success;
    3. load the order from `${RELAY_URL}/orders/<transaction>`;
    4. call `refundOrder` with the merchant key, then assert `ok: true`, and that the refund transaction's receipt has status success.

    It costs 0.01 USDT a run. cs-wc runs it on demand.

## Tests (offline unless stated)

1. **The browser entry builds.** `Bun.build({ entrypoints: ["packages/relay/src/browser.ts"], target: "browser" })` succeeds. A static walk of `browser.ts`'s imports finds no `node:`, `bun:` or `hono` import.
2. **`walletAccount`** signs typed data through the given function, and throws on `signMessage` and `signTransaction`.
3. **`refundOrder`**, with a fake fetch:
   - the held-escrow cancel, its whole amount only;
   - a paid refund;
   - a partial refund;
   - `not_your_order`;
   - `not_refundable`;
   - each of a network error, a 502 and a non-JSON body gives `ok: "unknown"`.
4. **The snippet.** Its two files hold 20 or fewer non-empty lines in all. `apps/web/server.ts` imports `checkout` from `examples/whitechain/checkout-merchant.ts`.
5. **The console's checkout.**
   - Unpaid `GET /checkout/sticker-pack` answers 402, with `PAYMENT-REQUIRED` naming `payTo` and the price 10000.
   - With `WC_MERCHANT_ADDRESS` unset, it answers 503 `no-checkout`.
6. **`/status` funding**, with a fake reader: the payees and shares, `relayerShareBps`, `feeSplitUsdt`, and `funding: null` when the startup read fails.
7. **Existing tests.** Every existing test passes **unedited**.

## Lease

- `packages/relay/src/headers.ts`, `refund-client.ts` and `browser.ts`, all new.
- `packages/relay/src/paywall.ts` and `pay-fetch.ts`, for the import only.
- `packages/relay/src/merchant.ts`, for Web Crypto only.
- `packages/relay/src/merchant-server.ts`, to call `refundOrder` only.
- `packages/relay/src/server.ts`, for `/status` funding only.
- `packages/relay/package.json`, for exports only.
- `packages/relay/test/*`.
- `examples/whitechain/*`, new.
- `apps/web/server.ts`, `apps/web/deploy.sh` and `apps/web/deploy/Dockerfile`, for D only.
- `apps/web/test/` and `apps/hub/test/`: new test files only.

Touch nothing else. No view code under `apps/web/src`. Never commit `bun.lock`.

## Constraints

- **No browser** of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools.
- **Never run `git stash`.** Use a temporary commit or a second worktree.
- **No network** in tests, except the live fixture behind `LIVE_WHITECHAIN=1`.
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
- 45 minutes have passed.

## Report

Write `.packets/reports/wc-10-console-checkout.md` in your worktree and commit it.
