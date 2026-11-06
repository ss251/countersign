# wc-03 — the merchant view, and the receipt the customer checks

## Goal

Build the `#/merchant` screen. A business that takes USDT on Whitechain through countersign opens it on a desktop. It shows:

- every order as it settles, with no reload;
- a one-click refund on each order;
- an export for the accountant;
- a small panel showing that the relayer, not the merchant and not the customer, paid the gas.

Also build `#/merchant/receipt/<orderId>`, the customer-facing record. It is a phone-width card that anyone with the link can check against the chain.

The demo films both screens. The design must hold up on camera.

## Lease

- `apps/web/src/routes/merchant/**` — create the folder. The router finds `routes/merchant/index.tsx` on its own.
- `apps/web/test/merchant.test.ts`

Do not edit anything else. That includes the router, `App.tsx`, `routes.ts`, styles and tokens, `apps/web/package.json`, `vite.config.ts` and `bun.lock`. Add no dependencies. You have React 19 and the browser.

## Context

Read these first:

- `apps/web/src/app/routes.ts` — `PageProps { params, query }`. `#/merchant/receipt/abc` gives `params = ["receipt", "abc"]`.
- `apps/web/src/app/router.tsx` — `Link`, `href`, `navigate`.
- `apps/web/src/styles/tokens.css` and `apps/web/src/styles/base.css` — colours, type sizes `--t-*`, spacing `--sp-*`, radii `--r-*`, durations `--d-*`/`--ease-out`, `--content` 1180px and `--phone` 390px. Also the `.num` (tabular figures) and `.mono` (hashes, addresses) classes.
- `apps/web/src/routes/seller/index.tsx` — a stub, showing the page skeleton.
- `docs/whitechain.md` — what the relay and merchant server do.

Brand rules. They are not negotiable.

- **Colour law.** `--usdc` blue means money, such as amounts in transit or held. `--settle` green means settled or paid. `--seal` red means refused, and appears only on an error. Refunded and cancelled are neutral: `--slate` on `--sunk`. Nothing else borrows these hues. No gradients, no glow, no glass, no shadows heavier than a 1px `--line` border.
- **Type.** The platform sans for words. `.mono` only for values read glyph by glyph (addresses, hashes). Amounts, counts and dates are sans with `.num`.
- **Voice.** Declarative, short, no exclamation marks. The product name is always lowercase: countersign. Use this copy:
  - refund success: `Refunded. 0.25 USDT returned to 0xcb39…4298.`
  - refund failure: `Refused. <reason in words>.`
  - empty state: `No orders yet. A payment shows up here the second it settles.`
  - gas panel: `Gas is paid by the countersign relayer. Customers never hold WBT.`
- **Light and dark.** Both come from the tokens. Never hard-code a colour.

## Data

The page talks to two local services. Each base URL comes from `import.meta.env`, with a default.

- **Merchant server**: `VITE_MERCHANT_URL`, default `http://127.0.0.1:8403`.
  - `GET /me` → `{ address }`
  - `GET /orders` → `{ orders: Order[] }`, only this merchant's orders, newest first
  - `POST /orders/:id/refund` with no body → `{ ok: true, txHash, txUrl, refunded, remaining }` or `{ ok: false, reason }`
  - `GET /orders.csv` → CSV download
- **Relay**: `VITE_RELAY_URL`, default `http://127.0.0.1:8402`.
  - `GET /status` → `{ address, balanceWei, balanceWbt, ceiling: { capWei, usedWei, remainingWei, txCount, maxTx, resetsAt }, network, chainId }`. Numbers are digit strings.
  - `GET /orders/:id` → `Order` plus `{ refunds: [...], settleTxUrl, closeTxUrl?, refundTxUrls }`

```ts
type Order = {
  id: string;                 // settlement tx hash (exact) or jobId (escrow)
  kind: "exact" | "escrow";
  customer: string;           // address
  merchant: string;           // address
  amount: string;             // atomic USDT, 6 decimals, digit string
  refunded: string;           // atomic
  refundable: string;         // atomic
  status: "pending" | "held" | "paid" | "partially_refunded" | "refunded" | "cancelled";
  createdAt: number;          // ms
  settleTx: string;           // tx hash
  closeTx?: string | null;    // release, cancel or refund tx
  refundTxs: string[];        // transfer refunds
  offerHash?: string; deadline?: number; resource?: string | null;
};
```

Explorer links follow `https://explorer.testnet.whitechain.io/tx/<hash>` and `https://explorer.testnet.whitechain.io/address/<addr>`.

## What to build

1. **`model.ts`** — pure functions, with no React and no fetch:
   - **`formatUsdt(atomic: string): string`** — `"250000"` → `"0.25"`, `"1000000"` → `"1.00"`. Use at least two decimals, keep up to six, and drop trailing zeros beyond two. String or bigint maths only, never floats.
   - **`shortAddress(a)`** — `0xcb39…4298`.
   - **`shortHash(h)`** — `0x4dc4…42bc`.
   - **`statusLabel(s)`** — `pending` → "Settling", `held` → "Held in escrow", `paid` → "Paid", `partially_refunded` → "Partly refunded", `refunded` → "Refunded", `cancelled` → "Cancelled".
   - **`statusTone(s)`** — `"money" | "settled" | "neutral"`: held and pending are money, paid is settled, the rest are neutral.
   - **`canRefund(order)`** — true when `status` is `held`, `paid` or `partially_refunded` and `refundable > 0`.
   - **`refundLabel(order)`** — `Refund 0.25`, or `Cancel and refund 0.25` when held.
   - **`totals(orders)`** — `{ received, refunded, net, count }` as atomic digit strings. `received` counts every order except pending and cancelled.
   - **`txUrl(hash)`**, **`addressUrl(addr)`**.
   - **`relativeTime(ms, now)`** — "just now", "2 min ago", "1 h ago", then a short date.

2. **`api.ts`** — typed fetchers for the endpoints above, with base URLs from `import.meta.env`. Every call rejects with an `Error` whose message is readable. Add a `fixtures.ts` with five realistic orders, one per status: two paid, one held, one partly refunded, one refunded. Use real-looking 0x hashes and the lane's addresses from `docs/whitechain.md`. Add a status payload too. When the page has `?fixture=1`, it uses fixtures and never fetches, so the screen can be reviewed with no services running.

3. **`index.tsx`** — the page. Its default export is a component taking `PageProps`. It routes on `params[0]`: `"receipt"` renders the receipt, anything else renders the desk.

4. **The desk (`Desk.tsx`)**, laid out top to bottom within `max-width: var(--content)`. Use `--sp-8` page padding and `--sp-6` between sections.
   - **Header row.**
     - Left side:
       - an h1 "Merchant" (`--t-24`);
       - under it, in slate `--t-13`: `Whitechain Sepolia · USDT · ` followed by the merchant address as a `.mono` link to the explorer.
     - Right side:
       - a secondary button "Export for accountant", 1px ink border, transparent, `--r-2`, 36px tall. It downloads `orders.csv` from the merchant server: fetch it as text and save it with a Blob URL and `download="countersign-orders-<yyyy-mm-dd>.csv"`.
   - **Figures row.** Four cells in a CSS grid, each with a 1px `--line` border, `--r-2` and `--raised` background:
     - Received
     - Refunded
     - Net
     - Orders

     Each cell has a label (slate `--t-12`, uppercase, 0.04em tracking) and a value (`--t-32`, `.num`). The value carries a `USDT` suffix in slate `--t-15`, except Orders. Received and Net are coloured `--usdc`; Refunded and Orders are ink.
   - **Gas panel.** A single line in `--sunk` with `--r-2` and `--sp-4` padding:
     - `Gas is paid by the countersign relayer. Customers never hold WBT.`
     - then, in slate `.num`: relayer `0xa2EE…6006` (a link), `<balanceWbt to 4 dp> WBT left`, and `<used>/<cap> WBT this hour` (from `ceiling`, as WBT with 4 dp).

     If `/status` fails, it reads `Relayer unreachable.` in slate. That is not an error colour.
   - **Orders table.** A semantic `<table>`, full width, with a 1px `--line` row border and 52px rows.
     - Columns:
       - Time: relative time, with `title` set to the ISO date;
       - Customer: `.mono` short address linked to the explorer;
       - Item: `resource`, or `Order <shortHash(id)>`, ellipsised to one line;
       - Amount: right-aligned `.num`, `0.25 USDT`, coloured by tone (`--usdc` for money, ink otherwise);
       - Status: a pill;
       - Proof: the `.mono` short settle hash linked to the explorer, plus the close or refund tx when present, both small;
       - a right-aligned action.
     - **Pill:** `--r-pill`, `--t-12`, 22px tall, `--sp-2` horizontal padding. Its background is the tone's wash (`--usdc-wash`, `--settle-wash`, or `--sunk` for neutral) and its text is the tone's colour (`--usdc`, `--settle`, `--slate`).
     - **Action:** the button shows `refundLabel(order)` when `canRefund`. It is ink text with a 1px `--line` border, 32px tall, `--r-2`, and the hover border is ink.
       - **On click:** disable it and show "Refunding…", then call refund.
       - **On success:** replace the action cell with a green `Refunded` and a short tx link, and show a toast-free inline line under the row: `Refunded. 0.25 USDT returned to 0xcb39…4298.` with an explorer link. The line fades in over `--d-2`.
       - **On failure:** an inline red line, `Refused. <reason>.`
       - Then re-fetch orders.
     - **Polling:** re-fetch `/orders` every 2.5 s while the tab is visible. A newly arrived row gets a 1.2 s `--usdc-wash` background that fades to transparent, so the camera sees it land. Respect `prefers-reduced-motion`: no fade, no highlight animation.
     - **Empty state:** the empty-state copy above, centred, slate, `--sp-12` padding.
     - **Merchant server unreachable:** one slate line, `The merchant service is not running on <url>.`, then keep polling.

5. **The receipt (`Receipt.tsx`)** for `#/merchant/receipt/<id>` — the customer's record.
   - A card centred on the page: max-width `var(--phone)`, 1px `--line` border, `--r-3`, `--raised`, `--sp-6` padding.
   - Contents, top to bottom:
     - "Receipt" in slate `--t-12` uppercase;
     - the amount `0.25 USDT` in `--t-44` `.num` `--usdc`;
     - `Paid to <merchant short>` and `from <customer short>`, both `.mono` links;
     - the status pill;
     - a definition list with Date (ISO local), Network (Whitechain Sepolia), Settlement (explorer link `shortHash`), plus Refund lines (each amount and explorer link) when present;
     - a footer in slate `--t-12`: `This record is on chain. Anyone can check it on the explorer, with or without countersign.`
   - It reads `GET {relay}/orders/:id`, or a fixture with `?fixture=1`.
   - Unknown id: `No order with that id.`

6. **`merchant.css`** — every class prefixed `mx-`, using tokens only. It is imported by `index.tsx`.

## Tests

`apps/web/test/merchant.test.ts` uses `bun:test` and covers `model.ts`:

- `formatUsdt` edge cases: 0, 1, 250000, 1000000, 1234567, 100000000;
- `statusLabel`/`statusTone` for every status;
- `canRefund` true and false cases;
- `refundLabel` for held and paid;
- `totals` over the fixtures;
- `relativeTime` boundaries.

## Constraints

- No floats for money anywhere.
- No new dependencies. No `localStorage`.
- Never print or embed a private key. The page holds none, and it doesn't need one.
- Accessibility:
  - buttons are real `<button>`s with visible focus, which base.css provides;
  - links have discernible text;
  - the table has a `<caption class="sr-only">`.
- No emoji. Small present-tense commits, no `Co-authored-by`. Never commit `bun.lock`.
- Never write the name of any earlier project.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test && bun run web:build
```

All four green. Then start `bun run --cwd apps/web dev` in the background, `curl -s http://127.0.0.1:5173/` to confirm it serves, and stop it. Port 5173 may be taken: if it is, skip the dev check and say so in the report.

## Stop conditions

- A needed change falls outside the lease.
- The build cannot resolve something without a dependency change.
- 100 minutes pass.

## Report

Write `$M/reports/wc-03-merchant-view.md`. Cover:

- what was built;
- the files;
- test counts;
- deviations;
- any copy you had to invent.
