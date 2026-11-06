# @countersign-hub/relay

Charge for an HTTP route in USDT on Whitechain, and pay for such a route from code. The payer holds USDT only, never WBT: a relay submits every transaction and pays the gas.

This runs on the testnet only: Whitechain testnet, chain id 1874. The settlement token is USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`.

## Install

```
npm i @countersign-hub/relay
```

- **Runtime:** Node 20 or later, or Bun. The package ships compiled JavaScript.
- **The merchant side** is Hono middleware, so a merchant also runs `npm i hono`.

There is no root export. Import one of the three subpaths below.

## Charge for a route (the merchant)

```ts
import { Hono } from "hono";
import { whitechainPaywall } from "@countersign-hub/relay/paywall";

const app = new Hono();
app.get(
  "/sticker-pack",
  whitechainPaywall({
    price: "0.01",
    payTo: "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c",
    facilitator: "https://whitechain-relay-production.up.railway.app",
    description: "sticker pack",
  }),
  (c) => c.json({ item: "sticker pack" }),
);
```

- **An unpaid request** gets HTTP 402. Its `PAYMENT-REQUIRED` header carries an x402 v2 offer for 0.01 USDT on `eip155:1874`.
- **A paid request** is verified and settled through the relay, then served.

**The public relay above settles only for its own demo merchant,** the `payTo` shown. It pays gas only for payees on its allowlist, so it refuses any other `payTo` as `payee_not_registered`. To charge to your own address, run your own relay: see `packages/relay` in the repository.

## Pay for a route (the customer)

In a browser, pay from the person's connected wallet. Nobody pastes a key:

```ts
import { createPayFetch, walletAccount } from "@countersign-hub/relay/browser";

// address and signTypedData come from the connected wallet (an injected wallet, or Privy).
const account = walletAccount(address, signTypedData);
const pay = createPayFetch({
  account,
  maxPerCall: "0.10",
  payTo: ["0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c"],
});

const res = await pay("https://example.com/sticker-pack");
console.log(await res.json(), res.payment?.transaction);
```

- **How it pays:** `pay` answers a 402 with one EIP-3009 authorization for the exact price, which the wallet signs. It then sends the request again with it.
- **What it refuses:** it never signs for more than `maxPerCall`, or for a `payTo` outside the list.
- **The receipt:** `res.payment.transaction` is the settlement transaction on chain 1874.
- **`walletAccount` signs typed data only.**

## Refund an order (the merchant)

```ts
import { refundOrder, walletAccount } from "@countersign-hub/relay/browser";
```

`refundOrder({ relayUrl, merchant, order })` refunds an order through the relay:
- **A paid order:** it signs an EIP-3009 transfer back to the customer. The transfer's nonce names the payment, so a double click refunds once.
- **A held escrow order:** it signs a cancel.

The relay submits either one.

`walletAccount(address, signTypedData)` turns a connected browser wallet into the signer `refundOrder` takes. It signs typed data only.

## Exports

| Import | What it gives you |
|---|---|
| `@countersign-hub/relay/paywall` | `whitechainPaywall`, Hono middleware that puts a USDT price on a route |
| `@countersign-hub/relay/pay-fetch` | `createPayFetch`, a `fetch` that pays 402 answers |
| `@countersign-hub/relay/browser` | the browser-safe set: `createPayFetch`, `refundOrder`, `walletAccount`, and the merchant's refund and cancel signers |

## What the relay guards

The relay pays gas from its own key, so it guards that key. Its live state is at `GET /status` on the relay.

| Guard | What it does |
|---|---|
| Allowlist | It acts only for its own payees, token and escrows. |
| Gas price cap | It refuses to send above its maximum fee. |
| Hourly ceiling | It caps its WBT spend and its transactions per hour. |
| Balance floor | It refuses new work rather than run dry in the middle of a payment. |
| Simulation | Every call is simulated before it is sent, so a refusal costs no gas. |

## Test funds and more

- **Getting testnet USDT, and the network details:** `docs/whitechain.md` in the repository.
- **Repository:** https://github.com/ss251/countersign, in `packages/relay`.
- **License:** MIT.
- **Names on npm:** only `@countersign-hub` is this project's. `countersign`, `countersign-mcp` and the `@countersign` scope belong to other projects.

## Advanced: CI

`createPayFetch` takes any viem account, so a CI job can build one with `privateKeyToAccount` from a secret.
- That key signs locally and is never sent anywhere.
- It must be a fresh testnet key made only for the job, holding only what the job spends, never a main wallet's.
