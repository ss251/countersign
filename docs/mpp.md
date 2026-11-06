# The mpp rail

Stripe's Machine Payments Protocol is the fourth rail. It is unlike the chain
rails: MPP is not x402 on the wire. A 402 carries a `WWW-Authenticate: Payment`
challenge whose `request` parameter is base64url JSON. The buyer returns the
credential in `Authorization: Payment ...`, and a successful response carries a
`Payment-Receipt` header.

The rail keeps the same interface as every other rail: `declaration`,
`challenge`, `verify`, `settle`. Hub wiring is a separate packet.

## One rail, two methods

`id: "mpp"` covers two MPP methods:

| Method | Network | Asset | Floor | Settlement |
| --- | --- | --- | --- | --- |
| Stablecoin (Tempo) | `mpp:tempo` | USDC on Tempo (6 decimals) | 0.01 USDC | Tempo transfer |
| Card (Stripe) | `mpp:stripe` | USD cents | 0.50 USD | Stripe PaymentIntent |

The stablecoin floor is 0.01 because that is the smallest useful Tempo charge.
The card floor is 0.50 because Stripe charges whole cents and does not accept
smaller card payments. A price below 0.01 is refused outright. A price from 0.01
to 0.49 gets a stablecoin challenge only. A price of 0.50 or more, in whole
cents, gets both methods in one challenge. A fractional-cent price gets the
stablecoin method only, because Stripe cannot charge it.

`challenge` returns the x402 requirements for the offer. `requirements.network`
is `mpp:stripe` when the card method is offered, otherwise `mpp:tempo`.
`extra.mpp.wwwAuthenticate` carries every eligible MPP method, and
`extra.mpp.methods` lists them. `extra.offerHash` binds the challenge to the
offer; the MPP challenges repeat it as `externalId`, so a receipt names the
offer.

## Why the declaration describes the stablecoin method

A `RailDeclaration` has one network and one asset, but this rail can be paid by
card or by stablecoin. The declaration describes the stablecoin method
(`mpp:tempo`, USDC) because it is the method whose asset is a concrete token and
whose challenge can be built without Stripe credentials. The card method is an
additional path inside the same rail; its receipts still say `method: "stripe"`.
The dashboard explorer template points at Stripe test payments because the card
method is the one with a payment reference.

## Mock mode

The rail and the demo endpoint run against a mock Stripe client. The mock
implements the only Stripe surface mppx uses,
`paymentIntents.create()`, records every call, and returns `pi_mock_1`,
`pi_mock_2`, and so on with status `succeeded`. It can also return
`requires_payment_method` to exercise the failure path. No Stripe key is read,
and no request leaves the process.

`stripeClientFromKey(key)` is the only bridge to the real SDK. It throws unless
the key starts with `sk_test_` or `rk_test_`. It is not used by the mock server
or by tests. Real sandbox credentials are still outstanding; until they arrive,
the rail stays in mock mode.

The HMAC secret passed to `createMppRail` and to `Mppx.create` binds challenge
ids. It is a local secret of at least 32 bytes, not a Stripe key.

## Running the demo endpoint

```
bun scripts/mpp/server.ts 8798
```

The first line says the server is in mock mode and makes no Stripe calls. The
server generates a fresh HMAC secret for the process. `GET /openapi.json`
advertises one paid operation, `GET /paid`, for 50 cents. Without a credential
that route returns the MPP challenge; with a valid one it returns a JSON body
and a `Payment-Receipt` header. The Stripe PaymentIntent is answered by the
mock.

Validate it with mppx's own CLI:

```
npx mppx@latest validate http://localhost:8798
```

The challenge, discovery, and error-handling checks pass. The card payment step
is skipped while no Stripe test key is configured. The CLI must not be allowed
to discover a local Stripe key automatically; run it with an environment that
does not expose one.

Validating a Tempo challenge is not an offline check. mppx's CLI resolves a
payer wallet and reads the token balance over a live Tempo RPC before it offers
to pay, so it is outside this lane. The rail stops Tempo at `verify` with
`tempo_verification_requires_rpc`; `settle` returns
`tempo_settlement_requires_rpc`. A Tempo RPC and a real deposit address are the
two things missing for the stablecoin side.

## Verify and settle

`verify` reads `payment.payload.credential`, the serialized MPP credential. It
checks the HMAC-bound challenge id, the realm, the expiry, the offer hash, the
amount, the currency, and the credential payload shape. It never creates a
PaymentIntent.

`settle` runs the same checks, then claims the challenge id once in an in-memory
store. A replayed credential is refused before Stripe is called. It then asks
mppx to verify the credential, which records the payment through
`client.paymentIntents.create()`. A client failure returns `success: false` with
no receipt.

## Receipt mapping

Settle maps to the slip like this:

- `settlement.transaction` = `receipt.reference` (the Stripe PaymentIntent id,
  `pi_...`).
- `settlement.receipt` = the serialized `Payment-Receipt` header.
- `settlement.network` = `mpp:stripe`.

The receipt deserializes to the MPP shape, for example:

```json
{ "method": "stripe", "reference": "pi_mock_1", "status": "success" }
```

mppx also adds the offer hash as `externalId` when the challenge carried it.
