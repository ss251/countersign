# The mpp rail

The Machine Payments Protocol (MPP), an open spec from Stripe and Tempo, is the
fourth rail. It is unlike the chain rails: MPP is not x402 on the wire. A 402 carries a `WWW-Authenticate: Payment`
challenge whose `request` parameter is base64url JSON. The buyer returns the
credential in `Authorization: Payment ...`, and a successful response carries a
`Payment-Receipt` header.

The rail leads with its native Tempo method: pathUSD on Tempo Moderato (chain
42431), settled for real by mppx. Stripe's card method is implemented behind
`MPP_STRIPE=1`, off by default, and gated on a Stripe sandbox business profile.
There is no mainnet configuration.

The rail keeps the same interface as every other rail: `declaration`,
`challenge`, `verify`, `settle`. Hub wiring is a separate packet.

## Live on Tempo testnet

On 06 Nov the `mppx` CLI paid our localhost demo endpoint twice on Tempo
Moderato. Both payments settled on chain and came back with a receipt.

- **Payer:** `0xEacEb7fD58157a39b6d4aF7A7Ca7A3AEba37486C`, a project account
  made with `mppx account create` and funded by the Moderato faucet. The CLI was
  told to use it by name.
- **Recipient:** `0xBfa03aCe72e48490C020Ab7CEe4beba2858f7231`, a fresh testnet
  address whose key and the challenge secret live only in a mode-0600 env file
  on the build machine.
- **Read before paying:** each 402 said `method tempo`, amount `10000`
  (0.01 pathUSD), currency `0x20c0000000000000000000000000000000000000`, chain
  42431 and this recipient.

| Route | What settles it | Transaction | Block | Receipt |
|---|---|---|---|---|
| `GET /paid` | mppx's own Tempo handler | [`0x254397b0…5df6`](https://explore.testnet.tempo.xyz/tx/0x254397b0afa7479e089948cddd58830b359b470d87dc96c56b71450f40d15df6) | 42848312 | `success`, 2026-11-06T11:50:49.980Z |
| `GET /rail/paid` | countersign's `mpp` rail: `challenge`, `verify`, then `settle` through `broadcastCredential` | [`0xd525b18b…5c33`](https://explore.testnet.tempo.xyz/tx/0xd525b18b225c939c1ba9c819fb536e036fd0405f0090c2ded0aabaf519b35c33) | 42848372 | `success`, 2026-11-06T11:51:22.160Z |

Each receipt decodes to `{ method: "tempo", status: "success", reference,
timestamp, fundingCurrency }`, and `reference` is the transaction hash. An MPP
receipt carries no separate id, so the slip records the hash in
`settlement.transaction` and the whole receipt in `settlement.receipt`.

Both transactions were checked on the Moderato RPC:

- status 1;
- one pathUSD `Transfer` of exactly 10000 from the payer to the recipient;
- a second, smaller pathUSD transfer to the fee manager. The payer pays its own
  network fee, which is why the declaration says `gasPaidBy: "buyer"`.

## One rail, two methods

`id: "mpp"` covers two MPP methods:

| Method | Network | Asset | Floor | Settlement |
| --- | --- | --- | --- | --- |
| Tempo (default) | `mpp:tempo` | pathUSD on Tempo Moderato, chain 42431 (6 decimals) | 0.01 pathUSD | Tempo transaction, checked or broadcast by mppx |
| Card (opt-in) | `mpp:stripe` | USD cents | 0.50 USD | Stripe PaymentIntent (sandbox) |

The Tempo floor is 0.01 because that is the smallest useful Tempo charge. A
price below 0.01 is refused outright. A price of 0.01 or more always gets a
Tempo challenge. The card method is offered only when the rail is constructed
with a Stripe client and the price is at least 0.50 USD in whole cents; a
fractional-cent price gets the Tempo method only, because Stripe cannot charge
it.

`challenge` returns the x402 requirements for the offer. Tempo is always first
in `extra.mpp.wwwAuthenticate`, and `extra.mpp.methods` lists every eligible
method. `requirements.network` is `mpp:stripe` when the card method is offered,
otherwise `mpp:tempo`. `extra.offerHash` binds the challenge to the offer; the
MPP challenges repeat it as `externalId`, so the HMAC-bound challenge names the
offer. The Tempo receipt does not echo it back. When
both methods are offered, `requirements.amount` is the card amount in cents; the
Tempo amount lives in the Tempo challenge, which the rail also HMAC-binds.

The Tempo method is built once per rail with mppx's `testnet: true` and the
pathUSD currency, so every Tempo challenge names chain 42431. There is no option
that produces the mainnet chain or a mainnet currency address. A Tempo
credential may carry a transaction hash the buyer already broadcast, a signed
transaction mppx broadcasts at settlement, or a zero-amount proof.

## The declaration

A `RailDeclaration` has one network and one asset, but this rail can be paid by
card or by stablecoin. The declaration describes the Tempo method (`mpp:tempo`,
pathUSD on Moderato) because that is the method that needs no Stripe account and
whose asset is a concrete token. Its asset is the pathUSD address on chain
42431, symbol `pathUSD`, 6 decimals. The declaration is `kind: "direct"`, and
`gasPaidBy` is `"buyer"`: the payer's transaction pays its own fee in a
stablecoin. Finality is the Tempo transaction's inclusion on Moderato, and the
explorer template is `https://explore.testnet.tempo.xyz/tx/{tx}`. The card
method is an additional path inside the same rail; its receipts still say
`method: "stripe"`.

## Stripe is opt-in

The rail takes an optional Stripe client and business network profile id. When
they are absent, the rail offers Tempo only and never touches a Stripe code
path. The demo server enables the card method only when `MPP_STRIPE=1`, and then
only through the mock Stripe client. The mock implements the only Stripe surface
mppx uses, `paymentIntents.create()`, records every call, and returns
`pi_mock_1`, `pi_mock_2`, and so on with status `succeeded`. It can also return
`requires_payment_method` to exercise the failure path. No Stripe key is read,
and no request leaves the process.

`stripeClientFromKey(key)` is the only bridge to the real SDK. It throws unless
the key starts with `sk_test_` or `rk_test_`. It is not used by the mock server
or by tests. Real sandbox credentials and a sandbox business profile are still
outstanding; until they arrive, the card method stays behind the flag and the
mock.

The HMAC secret passed to `createMppRail` and to `Mppx.create` binds challenge
ids. It is a local secret of at least 32 bytes, not a Stripe key. The rail reads
no environment variable; the server reads `MPP_SECRET_KEY` and `MPP_RECIPIENT`.

## Stateless inspection

The hub re-issues the payment requirements on the paid retry, so the challenge
ids in the 402 and in the retry are different. A rail that looked up the
credential's challenge id inside `requirements.extra.mpp.wwwAuthenticate` would
refuse every honest retry.

The rail therefore proves the credential's challenge without an id lookup:
`Challenge.verify` must accept the challenge's HMAC under the rail's secret, and
the realm must match. That proves the challenge, including every request field,
was issued by this rail. The rail then checks every field that decides the
payment against the current requirements: the `externalId` equals the offer
hash, the method is one the requirements offer, the Tempo amount, currency,
recipient and chain id 42431 match, the Stripe amount and `usd` currency match,
and the challenge has not expired. A recipient mismatch is `offer_mismatch`.
The old challenge's id and expiry are not compared to the fresh ones, which is
what lets the retry through.

## Running the demo endpoint

```
MPP_SECRET_KEY="$(openssl rand -base64 32)" \
MPP_RECIPIENT=0x00000000000000000000000000000000000000aa \
bun scripts/mpp/server.ts 8798
```

`MPP_SECRET_KEY` needs at least 32 bytes once decoded, or at least 43
characters. `MPP_RECIPIENT` must be a checksummed or lowercase 20-byte hex
address that is not the zero address. A missing or malformed value exits 1 with
a message naming the variable; the server never prints either value. Startup
prints one line: the port, Tempo testnet (Moderato, chain 42431), pathUSD, 0.01
per call, and whether the Stripe card method is on.

`GET /paid` is the mppx-native endpoint. Its 402 carries the Tempo challenge;
with a valid credential it answers `{ "ok": true, "resource": "countersign mpp
demo" }` and a `Payment-Receipt` header. `GET /rail/paid` runs the same payment
through `createMppRail`, which is the logic the hub will use: it issues the
requirements from the demo offer, verifies and settles the credential, and
returns the Tempo transaction hash. A refusal returns a fresh 402 challenge and
the refusal reason.

`GET /paid-card` exists only when the server starts with `MPP_STRIPE=1`; it
charges 0.50 USD through the mock Stripe client. `GET /openapi.json` and
`GET /llms.txt` describe the Tempo routes with mppx's `x-payment-info`
discovery shape.

## Running `mppx validate` safely on this machine

Validate only the card endpoint:

```
npx mppx@latest validate http://localhost:8798
```

The challenge, discovery, and error-handling checks pass. The card payment step
is skipped while no Stripe test key is configured.

Before running it:

- take the `stripe` CLI off `PATH`, for example by putting symlinks to `node`,
  `npm` and `npx` in a temporary directory and using that directory in place of
  the one that holds `stripe`;
- unset every `MPPX_STRIPE_*` and `STRIPE_*` variable.

`validate` auto-discovers a Stripe key through the stripe CLI, and this machine
must not expose one to it. Nobody runs the `stripe` CLI or reads its config
directory.

Never pass `--yes`, and never point `validate` at anything but localhost. Never
run it against a Tempo endpoint: the validator
resolves a local payer wallet and reads the token balance over a live Tempo RPC,
and with `--yes` it pays on chain. The Tempo side is exercised only by the
offline tests: `verify` stops at `tempo_verification_requires_rpc`, and `settle`
returns `tempo_settlement_requires_rpc`. A Tempo RPC and a real deposit address
are the two things missing for the stablecoin side.

## Verify and settle

`verify` reads `payment.payload.credential`, the serialized MPP credential. It
runs the stateless inspection for both methods and the replay check against the
`seen` store. For Tempo it then calls `mppx.validateCredential`, mppx's
non-mutating pre-check; a throw becomes `payment_failed`. The pre-check reads
the Tempo chain for a hash credential or simulates a signed transaction, so it
needs a live Tempo RPC. It never creates a PaymentIntent.

`settle` runs the inspection, then claims the challenge id once in the `seen`
store. A replayed credential is refused before mppx is called, and a claim is
never released. It then calls `mppx.broadcastCredential`, which re-validates the
credential and either checks the transaction on chain or broadcasts the signed
transaction. For Tempo, `receipt.reference` is the transaction hash. A throw
from mppx returns `success: false` with `payment_failed`, and the error text is
never echoed. The Stripe settle path is unchanged: it records the
PaymentIntent through `client.paymentIntents.create()`.

## Receipt mapping

Settle maps to the slip like this:

- `settlement.transaction` = `receipt.reference` (the Tempo transaction hash, or
  the Stripe PaymentIntent id `pi_...` for the card method).
- `settlement.receipt` = the serialized `Payment-Receipt` header.
- `settlement.network` = `mpp:tempo`, or `mpp:stripe` for the card method.

The receipt deserializes to the MPP shape. This one is from the live
`/rail/paid` payment above:

```json
{ "fundingCurrency": "0x20c0000000000000000000000000000000000000", "method": "tempo",
  "status": "success", "timestamp": "2026-11-06T11:51:22.160Z",
  "reference": "0xd525b18b225c939c1ba9c819fb536e036fd0405f0090c2ded0aabaf519b35c33" }
```
