# @countersign/relay

USDT on Whitechain for one HTTP route. The relay checks the payment and pays the gas.

## INSTALL

```sh
bun pm pack
bun add ./countersign-relay-0.1.0.tgz
```

A shop prices one route with `whitechainPaywall`. An agent pays with `createPayFetch` and refuses anything over its cap before it signs.

```ts
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createPayFetch } from "@countersign/relay/pay-fetch";
import { whitechainPaywall } from "@countersign/relay/paywall";

const payTo = process.env.WC_MERCHANT_ADDRESS ?? "";
const facilitator = process.env.RELAY_URL ?? "http://127.0.0.1:8402";
const app = new Hono();
app.get("/forecast",
  whitechainPaywall({ price: "0.05", payTo, facilitator, description: "Mumbai weather forecast" }),
  (c) => c.json({ city: "Mumbai", condition: "humid", temperatureC: 31 }),
);

const pay = createPayFetch({
  account: privateKeyToAccount(process.env.WC_BUYER_PRIVATE_KEY as `0x${string}`),
  maxPerCall: "0.10",
  budget: "5.00",
  payTo: [payTo],
});
const response = await pay("http://127.0.0.1:8404/forecast");
```
