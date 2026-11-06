# wc-05 — fix cs-w1's review of the relay (corrective)

## Goal

cs-w1 reviewed `packages/relay` at `d1fcf2a`. The review is at `/Users/thescoho/Developer/countersign-mumbai/reports/review-d1fcf2a.md`; read it first. It found two blockers and four should-fix items. Fix all six here, so that the relay can be integrated.

cs-w1's failing tests are on branch `cs/w1` in `packages/relay/test/w1-attacks.test.ts`. Copy that file into this worktree **unchanged** (`git show cs/w1:packages/relay/test/w1-attacks.test.ts > packages/relay/test/w1-attacks.test.ts`). Its tests must pass. Do not weaken them.

## Lease

- `packages/relay/**`

Do not touch `packages/rail/**`, `packages/core/**`, `apps/**`, `contracts/**`, `bun.lock` or the root `package.json`. Never commit `bun.lock`: run `git checkout -- bun.lock` before every commit.

## Context

- The review report named above.
- `packages/relay/src/{relayer,ceiling,exact,countersign-scheme,refund,escrow-ops,ledger,server,merchant,merchant-server,config,ports}.ts`.
- `packages/relay/test/support.ts`, which holds `FakeChain`, `createTestRelay` and `NOW`.

## Fixes

The list also covers cs-w1's second review (`/Users/thescoho/Developer/countersign-mumbai/reports/review-5444ec5.md`). That review adds three items:

- **B1b**, the same defect as B1 on `POST /orders/:id/refund`;
- **B2** now also covering released escrow jobs;
- a **toll decision**, written up below.

Copy the latest `packages/relay/test/w1-attacks.test.ts` from `cs/w1`. It has B1, B2 and B1b.

### B1 + B1b — the merchant server must authenticate

`POST /refund/:paymentId` and `POST /orders/:id/refund` currently make the merchant key sign for anyone. Fix:

- `createMerchantApp({ …, token?: string, origins?: string[] })`.
- Every route except `GET /me` and CORS preflight requires `Authorization: Bearer <token>`, compared in constant time with `crypto.timingSafeEqual` over equal-length buffers.
  - A missing or wrong token gets 401 `{ ok: false, reason: "unauthorized" }`, and nothing is fetched or signed.
  - With no `token` configured, every protected route answers 401. This fails closed, and it is what the cs-w1 test expects.
- CORS: drop `origin: "*"`. Allow only `origins`. The default is `["http://127.0.0.1:5173", "http://localhost:5173"]`. Allow the `Authorization` header.
- `loadMerchantConfig` reads:
  - `MERCHANT_TOKEN`: required, at least 24 characters. The error names the variable, never its value.
  - `MERCHANT_ORIGINS`: optional, comma separated.

  `import.meta.main` wires both.
- The merchant server also gets `GET /status`, which proxies the relay's `/status`, so the merchant page needs one origin only. Protect it like the other routes.

### B2 — a pending refund reserves its amount

A refund whose receipt timed out records nothing today, so a second click can refund twice.

**Ledger.** Add `status` (`pending | confirmed`) and `valid_before` (unix seconds) columns to `refunds`. Use `ALTER TABLE` when the columns are missing, so an existing database file keeps working. Then:

- `recordRefund` stores `confirmed`.
- New `recordPendingRefund(…, validBefore)`.
- `refundable(id)` subtracts confirmed **and** pending refunds.
- Listings and the CSV count only confirmed refunds as refunded. Show pending ones as `refund_pending` in the order and CSV status.

**Reconcile.** Add `reconcilePendingRefunds(paymentId, ctx)`. For each pending refund it looks up the receipt; add `getTransactionReceipt` to `ChainReader` and the fake.

- A successful receipt marks the refund `confirmed`.
- A reverted receipt deletes it.
- If there is no receipt and `now > valid_before + 60`, delete it. After `valid_before` the token itself refuses the authorisation, so the transfer can no longer land.
- Otherwise leave it pending.

`refundPayment` calls reconcile first, inside the relayer's `exclusive` section, before the refundable check.

**Payments and jobs.** Apply the same reconcile to pending `exact` payments and to pending escrow jobs:

- a settle retry of a pending item checks the receipt and promotes the item if it landed;
- `GET /orders/:id` promotes too.

### S1 — sponsor only registered merchants, above a minimum

**Policy.** Add `allowedPayees: Address[]` and `minAmount: bigint` to `RelayerPolicy`. The config reads them from:

- `RELAY_PAYEES`, comma separated, defaulting to `0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c`;
- `RELAY_MIN_AMOUNT`, atomic, defaulting to `10000`, which is 0.01 USDT.

**Where it applies:**

- `verifyExact`: `payTo` not registered gives `payee_not_registered`, and an amount below the minimum gives `amount_below_minimum`. These checks run before the signature check.
- `verifyCountersign`: the same checks against `paymentRequirements.payTo` and the amount, before `escrowRail.verify`.
- Refunds are unaffected; they are bound to recorded payments.

**Visibility.** `/status` shows `payees` and `minAmount`.

### S2 — the hourly ceiling survives a restart

**Ledger.** Add a `spends` table: `tx_hash`, `payer`, `cost_wei` (TEXT), `at` (ms), with methods `recordSpend` and `recentSpends(sinceMs)`.

**Relayer.** It takes an optional `onSpend({ txHash, payer, costWei, at })` hook.

- After a receipt, call it with the actual cost, whether the transaction was confirmed or reverted.
- On `pending`, call it with the worst case.

**Ceiling.** Add `SpendCeiling.seed(entries)`, which pre-fills entries with their original timestamps.

**Wiring.** `server.ts` connects the hook to the ledger and seeds the ceiling from `ledger.recentSpends(now - windowMs)` at startup.

**Test.** A new relayer and ceiling, seeded from a ledger that already holds a full hour's spend, refuses with `ceiling_wei`.

### Toll decision — a full refund, and the merchant absorbs the toll

A released escrow order paid the merchant `amount - toll`. The one-click refund still returns the **full** amount to the customer. The merchant absorbs the 1% toll, as with card fees.

Make that explicit:

- **Fee on orders.** `Order` gains `fee`: the toll for released escrow orders, `0` for everything else.
  - Read it from `escrow.tollOf(amount)` through `chainClient.readContract`, or compute it from the escrow's `tollBps` with the same rounding: `amount * tollBps / 10000`, rounded down.
  - Cache the value per escrow.
- **CSV columns.** The CSV gains a `fee_usdt` column after `amount_usdt`, and `net_usdt = amount - fee - refunded`, which can be negative. Update the header and the tests.
- **Balance check.** Before a refund by transfer, `refundPayment` reads the merchant's USDT `balanceOf`. If it cannot cover the value, refuse with `merchant_balance_low` before signing anything is relayed.
- **Merchant server.** It passes that reason straight through.

Tests:

- a released order shows the fee;
- the CSV `net` accounts for the fee;
- a refund is refused when the merchant balance is low.

### S3 — no fee estimate, no send

If `estimateFeesPerGas` returns `maxFeePerGas` as undefined or `0n`, refuse with `fee_too_high` and the detail `no fee estimate`.

Add a test.

### S4 — scope the public ledger

**List routes need a filter.** Each of these returns 400 `{ error: "filter_required" }` without one:

- `GET /payments` needs `payTo` or `payer`;
- `GET /orders` needs `merchant` or `customer`;
- the CSV routes need `payTo` or `merchant`.

**Detail routes stay public.** `GET /payments/:id` and `GET /orders/:id` are the customer's receipt. Leave them public.

**Tests.** Add a test for each filter refusal.

## Tests

- **cs-w1's file:** `packages/relay/test/w1-attacks.test.ts` passes, unchanged.
- **Per item:**
  - B1: a wrong token gives 401; the right token goes through to the relay; a preflight from a disallowed origin gets no `Access-Control-Allow-Origin`; `/me` stays public.
  - B2: reconcile drops a pending refund once its window has expired, confirms a pending refund whose receipt succeeded, and promotes a pending payment on retry.
  - S1: `exact` and `countersign` refusals for an unregistered payee and for an amount below the minimum.
  - S2: a seeded ceiling refuses.
  - S3: the missing-fee refusal.
  - S4: the filter refusals.
- **Existing tests:** update any that now fail only because they lack the token, a registered payee or a filter, keeping each one's meaning. Never delete a test to make it pass.

## Constraints

- **No browser of any kind on this machine.** No Chrome, Chromium, headless browsers, Playwright or Puppeteer, and no screenshots. Verify with tests and `curl` only. This is the captain's standing rule; a breach stops the run.
- Never log tokens, signatures or keys.
- No floats for money.
- Small present-tense commits, no emoji, no `Co-authored-by`.
- Never write the name of any earlier project.

## Acceptance

Run from the worktree root:

```
bun install && bun run typecheck && bun test && forge test
```

All green, including `w1-attacks.test.ts`. `git diff --stat cs/wc...HEAD` lists only `packages/relay/**` and `.packets/`.

## Stop conditions

- A needed change falls outside the lease.
- cs-w1's test cannot pass without changing it.
- One failure survives three different fixes.
- 100 minutes pass.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-05-review-fixes.md`:

- one line per fix, naming its test;
- the test counts;
- any deviations;
- the new environment variables, with their defaults.
