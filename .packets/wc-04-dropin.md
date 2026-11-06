# wc-04 — the drop-in: x402 paywall for a merchant API, pay-fetch for an agent

## Goal

Whitechain's business track asks for "a drop in piece, widget, SDK, payment link API or plugin that a separate demo app adds in about 20 lines". Build that piece on top of the relay, which is already a working x402 v2 facilitator for scheme `exact` on `eip155:1874`.

The piece has two halves:

- **Merchant side.** `whitechainPaywall()` is a Hono middleware. It puts a USDT price on any route.
  - A request without payment gets an x402 v2 `402`.
  - A paid request is verified through the relay, served, then settled through the relay.
- **Agent side.** `createPayFetch()` wraps `fetch`. When it meets a `402`, it signs one EIP-3009 authorisation within a spend limit and retries. The agent never holds WBT, never sees gas and never picks a chain.

Two example files show each half in about 20 lines.

## Lease

New files only:

- `packages/relay/src/paywall.ts`
- `packages/relay/src/pay-fetch.ts`
- `packages/relay/examples/shop.ts`
- `packages/relay/examples/agent.ts`
- `packages/relay/test/paywall.test.ts`
- `packages/relay/test/pay-fetch.test.ts`
- `packages/relay/test/dropin-e2e.test.ts`

Do not edit any existing file, including `packages/relay/src/index.ts`. The orchestrator adds the exports. Never commit `bun.lock`.

## Context

Read these first:

- `packages/core/src/wire.ts`: `PAYMENT_REQUIRED_HEADER`, `PAYMENT_SIGNATURE_HEADER`, `PAYMENT_RESPONSE_HEADER`, `toBase64Json`, `fromBase64Json`.
- `packages/core/src/amount.ts`: `parseUnits`, `formatUnits`, `parseAtomic`.
- `packages/relay/src/chain.ts`: `NETWORK`, `USDT`, `txUrl`.
- `packages/relay/src/eip3009.ts`: `signAuthorization`, `authorizationToWire`, `Authorization`.
- `packages/relay/src/exact.ts`: the request and response shapes of `/verify` and `/settle`.
- `packages/relay/src/server.ts`: `createRelayApp`.
- `packages/relay/test/support.ts`: `FakeChain`, `createTestRelay`. Build the e2e test on these.
- `packages/relay/scripts/pay-exact.ts`: a working payment, sent by hand.

x402 v2 over HTTP, the "authorization" flow (verify → resource → settle → respond):

- **Unpaid request.** Respond with status 402. The `PAYMENT-REQUIRED` header is `base64(json(PaymentRequired))`. The body is the same JSON.
  - `PaymentRequired = { x402Version: 2, error, resource: { url, description, mimeType }, accepts: [PaymentRequirements] }`
- **Paid request.** It carries `PAYMENT-SIGNATURE: base64(json(PaymentPayload))`.
  - `PaymentPayload = { x402Version: 2, resource, accepted, payload: { signature, authorization } }`
- **Response to a paid request.** It carries `PAYMENT-RESPONSE: base64(json(SettleResponse))`.

## What to build

1. **`src/paywall.ts`** exports `whitechainPaywall(opts)`, which returns a Hono `MiddlewareHandler`.
   - **Options:**
     - `price`: decimal USDT string, for example `"0.05"`; convert with `parseUnits(price, 6)`;
     - `payTo`: the merchant address, checksummed;
     - `facilitator`: the relay base URL;
     - `description`;
     - `mimeType`, default `application/json`;
     - `maxTimeoutSeconds`, default 120;
     - `fetch`, an injectable function for tests.
   - **Requirements:**
     ```
     { scheme: "exact", network: "eip155:1874", amount, asset: USDT.address, payTo,
       maxTimeoutSeconds, extra: { assetTransferMethod: "eip3009", name: "Tether USD", version: "1" } }
     ```
   - **No `PAYMENT-SIGNATURE` header:** respond 402 with the header and body, and `error: "Payment required."`.
   - **Header present:**
     1. Decode it. If it is undecodable, respond 402 with `error: "Refused. The payment header does not parse."`.
     2. POST `/verify` to the facilitator. If the result is invalid, respond 402 with `error: "Refused. " + reason`. The handler does not run.
     3. Run `next()`. If the handler's response status is 400 or above, do not settle: return its response unchanged, so the buyer is not charged for a failure.
     4. Otherwise POST `/settle`.
        - On success, set `PAYMENT-RESPONSE` on the handler's response and return it.
        - On failure, respond 402 with `error: "Refused. " + errorReason`. Do not return the resource body.
   - **Unreachable facilitator:** respond 503 with `{ error: "The payment service is unreachable." }`. Never throw.
   - **Resource URL:** use the request URL.

2. **`src/pay-fetch.ts`** exports `createPayFetch(opts)`, which returns `(input, init?) => Promise<Response>`.
   - **Options:**
     - `account`: a viem `LocalAccount`;
     - `maxPerCall`: decimal USDT, default `"1.00"`;
     - `budget?`: decimal USDT, the total across calls;
     - `fetch?`: injectable;
     - `now?`: injectable clock.
   - **Behaviour:**
     1. Do the request.
     2. If the status is not 402, return the response.
     3. Otherwise read `PAYMENT-REQUIRED`, or the JSON body if the header is absent. Pick the first entry in `accepts` with `scheme: "exact"`, `network: "eip155:1874"` and USDT as the asset (case-insensitive).
     4. If there is none, return the 402 as it is.
     5. If the amount is over `maxPerCall`, or would take the total past `budget`, throw `SpendLimitError` with a readable message. Sign nothing.
     6. Otherwise sign the authorisation: `to = payTo`, `value = amount`, `validAfter = 0`, `validBefore = now + maxTimeoutSeconds`, nonce = 32 random bytes.
     7. Retry once with `PAYMENT-SIGNATURE`, with the same method, body and headers.
   - **Response:** add a parsed `payment` property, `{ transaction, url, amount }`, read from `PAYMENT-RESPONSE` when present. Return a `Response` subclass or a wrapper object; document which in a JSDoc line.
   - **Spending:** count spending only after a 2xx response with a successful `PAYMENT-RESPONSE`. Export `spent()` on the returned function as a property.

3. **`examples/shop.ts`** is the separate demo app, at most 25 lines including imports. It is a Hono app with:
   - `GET /forecast`, priced at `"0.05"` through `whitechainPaywall`, returning a small JSON weather forecast for Mumbai;
   - `payTo` from `WC_MERCHANT_ADDRESS`, facilitator from `RELAY_URL`, default `http://127.0.0.1:8402`;
   - `Bun.serve` on `SHOP_PORT`, default 8404.

   No keys: the merchant only receives.

4. **`examples/agent.ts`** is at most 25 lines. It builds a `payFetch` from `WC_BUYER_PRIVATE_KEY` with `maxPerCall "0.10"`, calls `http://127.0.0.1:8404/forecast`, and prints:
   - the JSON;
   - the settlement explorer URL;
   - `spent()`.

   It never prints the key.

## Tests (offline)

- **`paywall.test.ts`** (stub facilitator `fetch`):
  - an unpaid request gives 402, and the header decodes to the same body with correct requirements;
  - a garbage header gives 402 with the parse message;
  - an invalid verify gives 402, and the handler is not called;
  - a valid payment runs the handler, calls settle, and sets the `PAYMENT-RESPONSE` header;
  - a handler that returns 500 is never settled;
  - a failed settle gives 402 without the body;
  - an unreachable facilitator gives 503.
- **`pay-fetch.test.ts`** (stub server `fetch`):
  - a 200 passes through without signing;
  - a 402 leads to a signature, and the signed authorisation matches the requirements;
  - `maxPerCall` and `budget` refusals throw `SpendLimitError` and send nothing;
  - a non-1874 or non-USDT entry is not paid;
  - `spent()` counts only settled calls.
- **`dropin-e2e.test.ts`:**
  - Wire the shop app (with the paywall), the relay app (`createRelayApp` over `createTestRelay`'s `FakeChain`) and `payFetch` together through in-process `fetch` stubs that route by URL host to `app.request`.
  - A full paid call returns the forecast and a `PAYMENT-RESPONSE`.
  - The relay's ledger records the payment.
  - A second call with an exhausted budget throws.

## Constraints

- No floats for money.
- Never log headers, signatures or keys.
- Keep both example files short and readable. They are what judges read.
- Small present-tense commits, no emoji, no `Co-authored-by`. Never write the name of any earlier project.

## Acceptance

From the worktree root:

```
bun install && bun run typecheck && bun test && forge test
```

All green. `wc -l packages/relay/examples/*.ts` shows 25 lines or fewer for each.

## Stop conditions

- An existing file needs a change.
- One failure survives three different fixes.
- 90 minutes have passed.

## Report

Write `/Users/thescoho/Developer/countersign-mumbai/reports/wc-04-dropin.md`. Include:

- what was built;
- test counts;
- the exports the orchestrator must add to `src/index.ts`;
- deviations.
