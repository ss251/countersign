# wc-06 — merchant view wiring and fixes (corrective, after wc-05)

## Goal

`#/merchant` and `#/merchant/receipt/:id` exist (`apps/web/src/routes/merchant/`). Before they can be filmed against live data, they need four fixes, one per change below.

wc-05 put the merchant server behind a bearer token, restricted its CORS, and added `GET /status` to it. Read `packages/relay/src/merchant-server.ts` as it is now.

## Lease

- `apps/web/src/routes/merchant/**`
- `apps/web/test/merchant.test.ts`
- `packages/relay/src/ledger.ts`, `packages/relay/src/exact.ts`, `packages/relay/src/countersign-scheme.ts`, `packages/relay/src/server.ts`. Description field only (change 4).
- `packages/relay/test/*.test.ts`. Tests for the description field only.

Do not edit anything else. Never commit `bun.lock`: run `git checkout -- bun.lock` before each commit.

## Changes

1. **Cancel replies are successes.** For a held escrow order, the merchant server's `POST /orders/:id/refund` answers `{ ok: true, transaction, url, status: "cancelled" }`. For a paid order it answers `{ ok: true, txHash, txUrl, refunded, remaining }`. `api.ts`'s `refundOrder` currently treats the first shape as an error.
   - Normalise both to `{ ok: true, txHash, refunded?: string }`.
   - When `refunded` is absent (a cancel returns the full amount), `Desk.tsx` uses `order.refundable`.
   - For a cancel, the inline line reads `Cancelled. 0.30 USDT returned to 0xcb39…4298.`
   - Add a test for the normaliser. Put it in `model.ts`, or in an exported pure function in `api.ts`.

2. **Bearer token.** Every merchant-server call except `/me` sends `Authorization: Bearer ${import.meta.env.VITE_MERCHANT_TOKEN}`.
   - If the token is unset, show one slate line: `The merchant console needs its token. Set VITE_MERCHANT_TOKEN.`
   - On a 401, show `The merchant service refused the token.`
   - Never print the token.

3. **Gas panel.** Read status from the merchant server's `GET /status`, not from the relay directly, so the page needs one origin. Poll it every 5 s while the tab is visible, as the orders are polled.

4. **Readable items.**
   - **Relay ledger:** store the payment's `resource.description` as a new nullable `description` column on payments and jobs. Use `ALTER TABLE` when the column is missing.
   - **Where it is set:** in `settleExact` and `settleCountersign`, from `paymentPayload.resource.description` when that is a string, capped at 120 characters.
   - **Where it shows:** `Order` and `/orders/:id` gain `description`.
   - **Merchant view:** the Item column shows `description ?? hubTitle ?? resource ?? "Order " + shortHash(id)`.
     - `hubTitle` is the offer title from the hub. For an order with `offerHash`, fetch `GET ${VITE_HUB_URL ?? "/hub"}/offers/<offerHash>`, which answers `Listing = { offerHash, offer: { title, … }, online, status }`.
     - Cache it per offerHash for the page's lifetime. A failure is cached as "no title". Never block rendering on it.
     - The hub's 402 carries the title as `resource.description`, but buyers may echo only the URL back, so this lookup is the reliable source.

5. **Receipt shows how the money finished.** `Receipt.tsx` adds a row driven by `status` and `closeTx`:
   - released (`paid` with `closeTx`): "Released" with the tx link;
   - `cancelled`: "Cancelled by the merchant. Full amount returned." with the tx link;
   - `refunded` with `closeTx` (the deadline passed): "Refunded after the deadline" with the tx link;
   - transfer refunds: "Refund", plus the amount and the tx link.

   The footer line is unchanged.

6. **Base URLs.** `VITE_MERCHANT_URL` defaults to `/merchant-api` and `VITE_RELAY_URL` to `/relay`. These are same-origin dev proxies; cs-ui adds them in `vite.config.ts`. A full URL in the env var still works.

7. **Fixes from the visual review.** The firstmate reviewed the merchant screens in a real browser. Make these changes exactly:
   - **(a) One colour rule: every USDT amount is `--usdc` blue**, in the figure cards, the table Amount column and the receipt. Order counts and labels stay ink. A row's state is shown only by its pill: green `paid`, blue `held`/`pending`, neutral `refunded`/`partially_refunded`/`cancelled`. Remove the per-tone amount colouring in the table.
   - **(b) A refund result is neutral, never green.** That covers the inline `Refunded. … returned to …` line, the `Cancelled. …` line and the `Refunded <hash>` text in the action cell. Use `--slate` text on no background, and keep the tx link.
   - **(c) Held money is not received money.**
     - **Cards:** `Received` · `Held in escrow` · `Refunded` · `Net`, in that order. The order count moves to the table caption heading, shown as a visible `Orders · 5` label above the table in slate `--t-13`.
     - **Escrow `closeKind`:** the relay's `Order` gains `closeKind: "release" | "cancel" | "deadline_refund" | null` for escrow orders and `null` for exact payments. It comes from the job's closing status: released → `release`, cancelled → `cancel`, refunded (the deadline passed) → `deadline_refund`.
     - **The four totals:**
       - `received` sums exact payments in any status except `pending`, plus escrow orders with `closeKind === "release"`;
       - `held` sums escrow orders with status `held`;
       - `refunded` sums transfer refunds only (`refunded` on orders). Cancels and deadline refunds were never received, so they do not count;
       - `net = received - fees - refunded`, using the order `fee` field from wc-05 (treat a missing fee as 0). It may be negative; show a leading minus.
     - **Tests:** cover every case in `totals`.
   - **(d) The fixture never repeats a tx hash.** Every hash in `fixtures.ts` is distinct.
   - **(e) Dates read like people write them.** The receipt shows `6 Nov 2026, 14:32 IST`. Use `Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" })` and accept whatever short zone name Intl gives. The desk's Time cell `title` uses the same format.

8. **The phone receipt drops the app nav.** cs-ui's router reads an optional `surface` export from a route module. In `apps/web/src/routes/merchant/index.tsx`, add:

   ```ts
   export const surface = (params: string[]) => (params[0] === "receipt" ? "bare" : "desk");
   ```

   Do this only if `apps/web/src/app/routes.ts` in your base reads `surface` from route modules (cs-ui `b2d3fba`). If it doesn't, skip this item and say so in the report.

## Tests

- **Refund reply normaliser:** both reply shapes.
- **Messages:** the token-missing message and the 401 message. Pure functions, or a fetch stub.
- **Relay:** `description` round-trips through settle, the ledger and `/orders/:id`, for both schemes.
- **Existing tests:** all stay green.

## Constraints

- **No browser of any kind on this machine.** That means no headless Chrome, Playwright, Puppeteer or screenshot tools. Verify with tests and `curl` only. UI checks go back to the lane, which raises NEEDS-BROWSER.
- No floats for money, no new dependencies, no `localStorage`.
- Brand: tokens only; the colour law (blue money, green settled, red refused, neutral refunded); lowercase countersign; declarative copy, no exclamation marks.
- Small present-tense commits, no emoji, no `Co-authored-by`. Never write the name of any earlier project.

## Acceptance

```
bun install && bun run typecheck && bun test && forge test && bun run web:build
```

All green from the worktree root.

## Stop conditions

- A change is needed outside the lease.
- A failure survives three different fixes.
- 80 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-06-merchant-wiring.md`. Cover what changed, the test counts and any deviations.
