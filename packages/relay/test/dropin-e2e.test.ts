import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { PAYMENT_RESPONSE_HEADER, fromBase64Json } from "@countersign/core";
import { createPayFetch, SpendLimitError } from "../src/pay-fetch.ts";
import type { FetchLike } from "../src/pay-fetch.ts";
import { createRelayApp } from "../src/server.ts";
import { createShop } from "../examples/shop.ts";
import { NOW, createTestRelay } from "./support.ts";

function wire(options: { budget?: string; maxPerCall?: string } = {}) {
  const relay = createTestRelay();
  const relayApp = createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: {},
  });

  let shop: Hono;
  const route: FetchLike = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.host === "shop.test") return shop.request(request);
    if (url.host === "relay.test") return relayApp.request(request);
    return new Response("not found", { status: 404 });
  };

  shop = createShop({
    payTo: relay.merchant.address,
    facilitator: "http://relay.test",
    fetch: route,
  });
  const pay = createPayFetch({
    account: relay.buyer,
    fetch: route,
    now: () => NOW,
    maxPerCall: options.maxPerCall ?? "0.10",
    budget: options.budget,
  });
  return { relay, pay };
}

describe("drop-in end to end", () => {
  test("a paid call returns the forecast and settles on the relay", async () => {
    const { relay, pay } = wire();
    const res = await pay("http://shop.test/forecast");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      city: "Mumbai",
      condition: "humid",
      temperatureC: 31,
      humidity: 78,
    });

    const header = res.headers.get(PAYMENT_RESPONSE_HEADER);
    expect(header).not.toBeNull();
    const settle = fromBase64Json<{ success: boolean; transaction: string }>(header!);
    expect(settle.success).toBe(true);
    expect(res.payment).toEqual({
      transaction: settle.transaction,
      url: "http://shop.test/forecast",
      amount: "50000",
    });
    expect(pay.spent()).toBe("0.05");

    const payments = relay.ledger.listPayments({ payTo: relay.merchant.address });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.payer).toBe(relay.buyer.address);
    expect(payments[0]!.amount).toBe(50_000n);
    expect(payments[0]!.resource).toBe("http://shop.test/forecast");
    expect(payments[0]!.txHash).toBe(settle.transaction);
  });

  test("a second call with an exhausted budget throws", async () => {
    const { pay } = wire({ budget: "0.05" });
    const first = await pay("http://shop.test/forecast");
    expect(first.status).toBe(200);
    expect(pay.spent()).toBe("0.05");
    await expect(pay("http://shop.test/forecast")).rejects.toBeInstanceOf(SpendLimitError);
    expect(pay.spent()).toBe("0.05");
  });
});
