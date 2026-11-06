# The mpp rail

Stripe's Machine Payments Protocol is the fourth rail. It is unlike the chain
rails: MPP is not x402 on the wire. A 402 carries a `WWW-Authenticate: Payment`
challenge whose `request` parameter is base64url JSON. The buyer returns the
credential in `Authorization: Payment ...`, and a successful response carries a
`Payment-Receipt` header.

The rail is testnet only: Tempo Moderato (chain 42431, pathUSD), Stripe test
mode. There is no mainnet configuration.

The rail keeps the same interface as every other rail: `declaration`,
`challenge`, `verify`, `settle`. Hub wiring is a separate packet.

## One rail, two methods

`id: "mpp"` covers two MPP methods:

| Method | Network | Asset | Floor | Settlement |
| --- | --- | --- | --- | --- |
| Stablecoin (Tempo) | `mpp:tempo` | pathUSD on Tempo Moderato (6 decimals) | 0.01 pathUSD | Tempo transfer |
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
offer. When both methods are offered, `requirements.amount` is the card amount
in cents; the stablecoin amount lives in the Tempo challenge, which the rail
also HMAC-binds.

## Why the declaration describes the stablecoin method

A `RailDeclaration` has one network and one asset, but this rail can be paid by
card or by stablecoin. The declaration describes the stablecoin method
(`mpp:tempo`, pathUSD on Moderato) because it is the method whose asset is a
concrete token and whose challenge can be built without Stripe credentials. Its
asset is the pathUSD address on chain 42431, symbol `pathUSD`, 6 decimals. The
card method is an additional path inside the same rail; its receipts still say
`method: "stripe"`. The dashboard explorer template points at Stripe test
payments because the card method is the one with a payment reference.

The Tempo method is created with mppx's `testnet: true` and the pathUSD currency,
so every Tempo challenge names chain 42431. There is no option that produces the
mainnet chain or a mainnet currency address.

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

## Running `mppx validate` safely on this machine

Validate only the card endpoint:

```
npx mppx@latest validate http://localhost:8798
```

The challenge, discovery, and error-handling checks pass. The card payment step
is skipped while no Stripe test key is configured.

Before running it, take the `stripe` CLI off `PATH` and unset
`MPPX_STRIPE_SECRET_KEY` and `MPPX_STRIPE_SPT_URL`. `validate` auto-discovers a
Stripe key through the stripe CLI, and this machine must not expose one to it.

Never pass `--yes`. Never run `validate` against a Tempo endpoint: the validator
resolves a local payer wallet and reads the token balance over a live Tempo RPC,
and with `--yes` it pays on chain. The Tempo side is exercised only by the
offline tests: `verify` stops at `tempo_verification_requires_rpc`, and `settle`
returns `tempo_settlement_requires_rpc`. A Tempo RPC and a real deposit address
are the two things missing for the stablecoin side.

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
