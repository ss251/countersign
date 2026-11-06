import { Hono } from "hono";
import { getAddress } from "viem";
import type { Address } from "viem";
import { whitechainPaywall } from "../src/paywall.ts";
import type { PaywallFetch } from "../src/paywall.ts";

export function createShop(input: { payTo: Address; facilitator: string; fetch?: PaywallFetch }) {
  const app = new Hono();
  app.get(
    "/forecast",
    whitechainPaywall({ price: "0.05", description: "Mumbai weather forecast", ...input }),
    (c) => c.json({ city: "Mumbai", condition: "humid", temperatureC: 31, humidity: 78 }),
  );
  return app;
}

if (import.meta.main) {
  const app = createShop({
    payTo: getAddress(process.env.WC_MERCHANT_ADDRESS ?? ""),
    facilitator: process.env.RELAY_URL ?? "http://127.0.0.1:8402",
  });
  Bun.serve({ port: Number(process.env.SHOP_PORT ?? 8404), fetch: app.fetch });
}
