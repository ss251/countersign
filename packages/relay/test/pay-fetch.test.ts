import { describe, expect, test } from "bun:test";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  fromBase64Json,
  parseUnits,
  toBase64Json,
} from "@countersign/core";
import { NETWORK, USDT } from "../src/chain.ts";
import { authorizationFromWire } from "../src/eip3009.ts";
import { createPayFetch, SpendLimitError } from "../src/pay-fetch.ts";
import type { FetchLike, PaidResponse } from "../src/pay-fetch.ts";
import type { PaymentPayload, PaymentRequirements } from "../src/exact.ts";
import { PAYMENT_RETRY_HEADER } from "../src/paywall.ts";
import { NOW, createTestRelay, makeRequirements } from "./support.ts";

const RESOURCE = "http://shop.test/forecast";
const RETRY_TOKEN = `0x${"ab".repeat(16)}`;

function pending402(token: string): Response {
  return new Response(JSON.stringify({ error: "Refused. settlement_pending" }), {
    status: 402,
    headers: {
      "content-type": "application/json",
      [PAYMENT_RETRY_HEADER]: token,
    },
  });
}

function challenge(requirements: PaymentRequirements): Response {
  const body = {
    x402Version: 2,
    error: "Payment required.",
    resource: { url: RESOURCE, description: "forecast", mimeType: "application/json" },
    accepts: [requirements],
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      [PAYMENT_REQUIRED_HEADER]: toBase64Json(body),
    },
  });
}

function settled(tx = "0xabc", success = true): Response {
  const body = { success, transaction: success ? tx : "", network: NETWORK, amount: "50000" };
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      [PAYMENT_RESPONSE_HEADER]: toBase64Json(body),
    },
  });
}

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function signatureOf(init: RequestInit | undefined): PaymentPayload {
  const header = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
  if (!header) throw new Error("no payment signature on the retry");
  return fromBase64Json<PaymentPayload>(header);
}

describe("createPayFetch", () => {
  test("a 200 passes through without signing", async () => {
    const relay = createTestRelay();
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return ok();
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });
    const res = await pay(RESOURCE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.payment).toBeUndefined();
    expect(calls).toBe(1);
    expect(pay.spent()).toBe("0");
  });

  test("a 402 leads to one signature that matches the requirements", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { maxTimeoutSeconds: 60 },
    );
    const seen: { payload?: PaymentPayload; init?: RequestInit } = {};
    let calls = 0;
    const fetch: FetchLike = async (_input, init) => {
      calls += 1;
      if (calls === 1) return challenge(requirements);
      seen.payload = signatureOf(init);
      seen.init = init;
      return settled();
    };
    const pay = createPayFetch({
      account: relay.buyer,
      fetch,
      now: () => NOW,
      maxPerCall: "0.10",
    });
    const res = await pay(RESOURCE, {
      method: "POST",
      body: JSON.stringify({ days: 2 }),
      headers: { "x-test": "yes" },
    });

    expect(res.status).toBe(200);
    expect(res.payment).toEqual({ transaction: "0xabc", url: RESOURCE, amount: "50000" });
    expect(pay.spent()).toBe("0.05");
    expect(calls).toBe(2);

    const payload = seen.payload!;
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toEqual(requirements);
    const auth = authorizationFromWire(payload.payload.authorization);
    expect(auth.from).toBe(relay.buyer.address);
    expect(auth.to).toBe(relay.merchant.address);
    expect(auth.value).toBe(50_000n);
    expect(auth.validAfter).toBe(0n);
    expect(auth.validBefore).toBe(BigInt(NOW + 60));
    expect(auth.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(seen.init?.method).toBe("POST");
    expect(seen.init?.body).toBe(JSON.stringify({ days: 2 }));
    expect(new Headers(seen.init?.headers).get("x-test")).toBe("yes");
  });

  test("a 402 with the challenge only in the body is still paid", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    let calls = 0;
    const fetch: FetchLike = async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        const body = {
          x402Version: 2,
          error: "Payment required.",
          resource: { url: RESOURCE, description: "forecast", mimeType: "application/json" },
          accepts: [requirements],
        };
        return new Response(JSON.stringify(body), {
          status: 402,
          headers: { "content-type": "application/json" },
        });
      }
      expect(signatureOf(init).accepted).toEqual(requirements);
      return settled();
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });
    const res = await pay(RESOURCE);
    expect(res.status).toBe(200);
    expect(res.payment?.transaction).toBe("0xabc");
    expect(pay.spent()).toBe("0.05");
  });

  test("maxPerCall refuses and never signs", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.11", USDT.decimals),
    );
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return challenge(requirements);
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW, maxPerCall: "0.10" });
    await expect(pay(RESOURCE)).rejects.toBeInstanceOf(SpendLimitError);
    expect(calls).toBe(1);
    expect(pay.spent()).toBe("0");
  });

  test("budget refuses once the next call would pass it", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return calls % 2 === 1 ? challenge(requirements) : settled();
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW, budget: "0.08" });
    await pay(RESOURCE);
    expect(pay.spent()).toBe("0.05");
    await expect(pay(RESOURCE)).rejects.toBeInstanceOf(SpendLimitError);
    expect(calls).toBe(3);
    expect(pay.spent()).toBe("0.05");
  });

  test("a non-1874 entry is not paid", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { network: "eip155:1" },
    );
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return challenge(requirements);
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });
    const res = (await pay(RESOURCE)) as PaidResponse;
    expect(res.status).toBe(402);
    expect(res.payment).toBeUndefined();
    expect(calls).toBe(1);
  });

  test("a non-USDT entry is not paid", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { asset: "0x1111111111111111111111111111111111111111" },
    );
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return challenge(requirements);
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });
    const res = await pay(RESOURCE);
    expect(res.status).toBe(402);
    expect(calls).toBe(1);
  });

  test("spent counts when it signs, not when it sees a receipt", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return challenge(requirements);
      if (calls === 2) return settled("0xabc", false);
      if (calls === 3) return challenge(requirements);
      return settled("0xdef");
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });

    const failed = await pay(RESOURCE);
    expect(failed.payment).toBeUndefined();
    expect(pay.spent()).toBe("0.05");

    const good = await pay(RESOURCE);
    expect(good.payment).toEqual({ transaction: "0xdef", url: RESOURCE, amount: "50000" });
    expect(pay.spent()).toBe("0.1");
    expect(calls).toBe(4);
  });

  test("validBefore is capped at five minutes", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { maxTimeoutSeconds: 1_000_000_000 },
    );
    let payload: PaymentPayload | undefined;
    const fetch: FetchLike = async (_input, init) => {
      if (!new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER)) return challenge(requirements);
      payload = signatureOf(init);
      return settled();
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => NOW });
    await pay(RESOURCE);
    const auth = authorizationFromWire(payload!.payload.authorization);
    expect(auth.validBefore).toBe(BigInt(NOW + 300));
  });

  test("a merchant that always answers 500 gets at most one authorisation under a one-call budget", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { maxTimeoutSeconds: 1_000_000_000 },
    );
    let signed = 0;
    const fetch: FetchLike = async (_input, init) => {
      if (!new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER)) return challenge(requirements);
      signed += 1;
      return new Response("boom", { status: 500 });
    };
    const pay = createPayFetch({
      account: relay.buyer,
      fetch,
      now: () => NOW,
      maxPerCall: "0.10",
      budget: "0.05",
    });

    const failed = await pay(RESOURCE);
    expect(failed.status).toBe(500);
    await expect(pay(RESOURCE)).rejects.toBeInstanceOf(SpendLimitError);
    expect(signed).toBe(1);
    expect(pay.spent()).toBe("0.05");
  });

  test("a pending payment is retried with the same signature and the token", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    const signatures: string[] = [];
    let paid = 0;
    const fetch: FetchLike = async (_input, init) => {
      const signature = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
      if (!signature) return challenge(requirements);
      signatures.push(signature);
      paid += 1;
      if (paid === 1) return pending402(RETRY_TOKEN);
      expect(new Headers(init?.headers).get(PAYMENT_RETRY_HEADER)).toBe(RETRY_TOKEN);
      return settled();
    };
    const sleeps: number[] = [];
    const pay = createPayFetch({
      account: relay.buyer,
      fetch,
      now: () => NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const res = await pay(RESOURCE);
    expect(res.status).toBe(200);
    expect(res.payment).toEqual({ transaction: "0xabc", url: RESOURCE, amount: "50000" });
    expect(signatures).toHaveLength(2);
    expect(new Set(signatures).size).toBe(1);
    expect(sleeps).toEqual([2000]);
    expect(pay.spent()).toBe("0.05");
  });

  test("a pending payment stops after three retries", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    const signatures: string[] = [];
    let paid = 0;
    const fetch: FetchLike = async (_input, init) => {
      const signature = new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER);
      if (!signature) return challenge(requirements);
      signatures.push(signature);
      paid += 1;
      if (paid === 1) return pending402(RETRY_TOKEN);
      expect(new Headers(init?.headers).get(PAYMENT_RETRY_HEADER)).toBe(RETRY_TOKEN);
      return new Response(JSON.stringify({ error: "Refused. This payment is still settling." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    };
    const sleeps: number[] = [];
    const pay = createPayFetch({
      account: relay.buyer,
      fetch,
      now: () => NOW,
      retryDelayMs: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const res = await pay(RESOURCE);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Refused. This payment is still settling." });
    expect(signatures).toHaveLength(4);
    expect(new Set(signatures).size).toBe(1);
    expect(sleeps).toEqual([5, 5, 5]);
    expect(pay.spent()).toBe("0.05");
  });

  test("reconcile releases an expired authorisation the chain never used", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
      { maxTimeoutSeconds: 60 },
    );
    let at = NOW;
    const fetch: FetchLike = async (_input, init) => {
      if (!new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER)) return challenge(requirements);
      return new Response("boom", { status: 500 });
    };
    const reader = {
      readContract: async () => false,
    };
    const pay = createPayFetch({ account: relay.buyer, fetch, now: () => at, reader });
    await pay(RESOURCE);
    expect(pay.spent()).toBe("0.05");

    at = NOW + 60;
    await pay.reconcile();
    expect(pay.spent()).toBe("0.05");

    at = NOW + 61;
    await pay.reconcile();
    expect(pay.spent()).toBe("0");
  });

  test("an unknown merchant is refused before signing", async () => {
    const relay = createTestRelay();
    const requirements = makeRequirements(
      relay.merchant.address,
      parseUnits("0.05", USDT.decimals),
    );
    let calls = 0;
    const fetch: FetchLike = async (_input, init) => {
      calls += 1;
      if (!new Headers(init?.headers).get(PAYMENT_SIGNATURE_HEADER)) return challenge(requirements);
      throw new Error("signed");
    };
    const pay = createPayFetch({
      account: relay.buyer,
      fetch,
      now: () => NOW,
      payTo: ["0x3333333333333333333333333333333333333333"],
    });
    await expect(pay(RESOURCE)).rejects.toBeInstanceOf(SpendLimitError);
    expect(calls).toBe(1);
    expect(pay.spent()).toBe("0");
  });
});
