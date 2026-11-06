# hd-06-mpp-rail: Stripe MPP as the fourth rail, proven against a mock

## Goal

Add the `mpp` rail (Stripe Machine Payments Protocol) and prove it against a mock Stripe client. Tracked by issue #5.

Three pieces:

1. **`packages/rail/src/mpp/`:** a `Rail` for network `mpp:stripe`, plus a mock Stripe client.
2. **`scripts/mpp/server.ts`:** an MPP-native endpoint on localhost that `npx mppx@latest validate` accepts.
3. **`docs/mpp.md`.**

MPP is not x402 on the wire. The challenge is a 402 with `WWW-Authenticate: Payment ... request="<base64url>"`. The credential comes back in `Authorization: Payment ...`, and success adds a `Payment-Receipt` header. The hub's x402 glue is not part of this packet.

## Lease

- Create `packages/rail/src/mpp/**`, `scripts/mpp/**` and `docs/mpp.md`.
- `packages/rail/package.json`: add `"mppx": "0.17.1"` to `dependencies` and `"./mpp": "./src/mpp/index.ts"` to `exports`. Change nothing else in it.
- Report: `/Users/thescoho/Developer/countersign-mumbai/reports/hd-06-mpp-rail.md`.

## Context

Read first:

- **Rail interface:** `packages/rail/src/rail.ts` (`Rail`, `RailDeclaration`).
- **Core types:** `packages/core/src/types.ts` (`Network` includes `"mpp:stripe"`; `SettleResult.receipt` is the MPP receipt; `PaymentRequirements`, `PaymentPayload`, `Offer.price` is atomic 6-decimal USD).
- **Example rail:** `packages/rail/src/hedera/rail.ts`, especially its settle-once claim store.
- **mppx 0.17.1** (in node_modules after install):
  - `dist/server/Mppx.d.ts`: `create`, `charge`, `challenge.*`, credential verification;
  - `dist/stripe/server/Charge.d.ts`, the `stripe.charge` parameters;
  - `dist/stripe/internal/types.d.ts`: the duck-typed `StripeClient` is only `paymentIntents.create() -> {id, status}`;
  - `dist/Receipt.d.ts`, `dist/Challenge.d.ts`, `dist/Credential.d.ts`;
  - `dist/stripe/client/`, which shows how a client builds a credential;
  - `dist/cli/validate/discovery.js`, `challenge.js` and `payment.js`: exactly what `validate` checks.
- In `Mppx.create`, `secretKey` is an HMAC secret for challenge ids (at least 32 bytes). It is not a Stripe key.

## Required

1. **`mock.ts`:** `mockStripeClient({ fail?: boolean })`. It implements the duck-typed `StripeClient`: `paymentIntents.create(params)` records the params and returns `{ id: "pi_mock_<n>", status: "succeeded" }`. With `fail`, it returns `status: "requires_payment_method"`. Export the call log for tests.
2. **`rail.ts`:** `createMppRail({ client, networkId, secretKey, realm, maxTimeoutSeconds? })`, returning a `Rail` (`id: "mpp"`, `network: "mpp:stripe"`, `kind: "direct"`) with:
   - **Amounts.** `offer.price` is atomic 6-decimal USD; Stripe charges cents. `challenge` throws when the price is not a whole number of cents, or is under the 0.50 USD card floor.
   - **`challenge(offer, ctx)`** returns `{scheme: "exact", network: "mpp:stripe", amount: <cents>, asset: "usd", payTo: networkId, maxTimeoutSeconds, extra: {offerHash, mpp: {wwwAuthenticate: <the serialized MPP challenge for this amount>}}}`. If the MPP challenge can carry an external id or description, put the offer hash there, so the receipt names the offer.
   - **`verify(payment, req)`** reads `payment.payload.credential`, the MPP credential string. It checks the HMAC-bound challenge id, the amount, the currency and expiry against `req` without creating any PaymentIntent.
   - **`settle`**:
     - First claim the challenge id once (in-memory store, same idea as the hedera rail's `seen`); a replayed credential is refused before the client is called.
     - Then run mppx's verification, which records the payment through `client.paymentIntents.create`, and return `{success: true, transaction: receipt.reference, network: "mpp:stripe", receipt: <serialized Payment-Receipt>}`.
     - A client failure returns `success: false` with no receipt.
   - **Declaration:** `explorerTx` is `https://dashboard.stripe.com/test/payments/{tx}`. The `finality` sentence says the payment is final when Stripe confirms the PaymentIntent.
3. **`scripts/mpp/server.ts [port]`** (default 8798) runs on `Bun.serve` with no framework.
   - The first output line says mock mode, no Stripe calls.
   - It generates a random 32-byte HMAC secret at start.
   - `GET /openapi.json` lists one paid operation with `x-payment-info`, in the shape `discovery.js` expects.
   - The paid route uses `Mppx.create({ methods: [stripe.charge({ client: mockStripeClient(), networkId: "profile_test_mock", currency: "usd", decimals: 2, paymentMethodTypes: ["card"] })], secretKey, realm: "localhost" })` and `mppx.charge({ amount: "50" })(request)`. It answers the 402 challenge, or `withReceipt(Response.json({ ok: true }))`.
4. **Tests** in `packages/rail/src/mpp/test/`, offline:
   - challenge shape, cents conversion and the floor refusal;
   - `verify` accepts a credential built for the challenge and refuses a tampered one, a different amount and an expired one;
   - `settle` returns the mock PaymentIntent id as `transaction`, and a `receipt` that deserializes to `{method: "stripe", reference: "pi_mock_…", status: "success"}`;
   - a replayed credential is refused without a second client call;
   - a failing client gives `success: false`.

   Build credentials with mppx's own client or `Credential` helpers. If the stripe client method needs Stripe.js, construct the credential from the `Credential` helpers and say so in the report.
5. **`docs/mpp.md`** covers:
   - what the rail is, and that it runs in mock mode until test keys arrive;
   - how to run the endpoint and `npx mppx@latest validate`;
   - how the receipt maps to the slip (`settlement.transaction` = `receipt.reference`, `settlement.receipt` = the serialized Payment-Receipt).

   No keys and no paths.

## Constraints

- No browser of any kind on this machine: no headless Chrome, Playwright, Puppeteer or screenshot tools. UI checks go back to the lane, which raises NEEDS-BROWSER.
- **No Stripe calls and no keys.** Never read any `.env` or config file, never read anything under a home config directory, and never print a secret. The only network allowed is the npm registry (`bun install`, `npx mppx@latest`) and localhost.
- Change nothing outside the lease. Never stage `bun.lock`. Run `bun install` after adding the dependency.

## Acceptance

```
bun run typecheck && bun test packages/rail/src/mpp
bun scripts/mpp/server.ts 8798 &   # then:
npx mppx@latest validate http://localhost:8798
```

The tests must pass with none skipped. `validate` must report no failures; skipped payment checks for the stripe method are fine. Paste the full `validate` output into the report and stop the server afterwards. Commit on `cs/hd-06` with short present-tense messages ending `refs #5`, and no trailers.

## Stop conditions

- `validate` cannot pass without a live Stripe call or a real payment: stop and paste its output.
- mppx's real API differs from this brief: follow mppx, and list each deviation in the report.
