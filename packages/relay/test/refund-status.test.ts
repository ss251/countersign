import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createMerchantApp } from "../src/merchant-server.ts";
import { refundOrderWithStatus } from "../src/refund-client.ts";
import type { RefundOrderInput, RefundOrderView } from "../src/refund-client.ts";
import { NOW } from "./support.ts";

const MERCHANT = privateKeyToAccount(generatePrivateKey());
const CUSTOMER = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const JOB = `0x${"ab".repeat(32)}` as Hex;
const TOKEN = "test-merchant-token-0123456789";

function order(overrides: Partial<RefundOrderView> = {}): RefundOrderView {
  return {
    id: JOB,
    kind: "exact",
    status: "paid",
    customer: CUSTOMER,
    merchant: MERCHANT.address,
    amount: "2000000",
    refunded: "0",
    ...overrides,
  };
}

describe("refundOrderWithStatus", () => {
  test("each local refusal carries its merchant status", async () => {
    const never = (async () => {
      throw new Error("no relay call expected");
    }) as unknown as typeof fetch;
    const cases: Array<{
      order: RefundOrderView;
      input: Partial<RefundOrderInput>;
      status: number;
      reason: string;
    }> = [
      {
        order: order({ merchant: OTHER }),
        input: {},
        status: 403,
        reason: "not_your_order",
      },
      {
        order: order({ kind: "escrow", status: "held", amount: "1500000" }),
        input: { amount: 750_000n },
        status: 400,
        reason: "partial_cancel_not_possible",
      },
      {
        order: order({ refunded: "1500000" }),
        input: { amount: 1_000_000n, now: () => NOW },
        status: 400,
        reason: "refund_not_possible",
      },
      {
        order: order({ status: "cancelled" }),
        input: {},
        status: 409,
        reason: "not_refundable",
      },
    ];

    for (const entry of cases) {
      const result = await refundOrderWithStatus({
        relayUrl: "http://relay.test",
        merchant: MERCHANT,
        order: entry.order,
        fetch: never,
        ...entry.input,
      });
      expect(result).toEqual({
        reply: { ok: false, reason: entry.reason },
        status: entry.status,
      });
    }
  });

  test("a thrown fetch is unknown with 502", async () => {
    const send = (async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;
    const result = await refundOrderWithStatus({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      now: () => NOW,
      fetch: send,
    });
    expect(result.status).toBe(502);
    expect(result.reply.ok).toBe("unknown");
  });

  test("a relay reply carries the relay's own status", async () => {
    const send = (async () =>
      Response.json({ ok: false, reason: "job_not_open" }, { status: 422 })) as unknown as typeof fetch;
    const result = await refundOrderWithStatus({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order({ kind: "escrow", status: "held", amount: "1500000" }),
      fetch: send,
    });
    expect(result).toEqual({
      reply: { ok: false, reason: "job_not_open" },
      status: 422,
    });
  });
});

describe("merchant refund route status", () => {
  test("a relay refusal reaches the client as 422 with its body", async () => {
    const jobId = `0x${"cd".repeat(32)}` as Hex;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith(`/orders/${jobId}`)) {
        return Response.json({
          id: jobId,
          kind: "escrow",
          status: "held",
          customer: CUSTOMER,
          merchant: MERCHANT.address,
          amount: "1500000",
          refunded: "0",
        });
      }
      if (url.endsWith("/escrow/cancel")) {
        return Response.json({ ok: false, reason: "job_not_open" }, { status: 422 });
      }
      return Response.json({ ok: false, reason: "unexpected" }, { status: 500 });
    }) as typeof fetch;

    try {
      const app = createMerchantApp({
        merchant: MERCHANT,
        relayUrl: "http://relay.test",
        now: () => NOW,
        token: TOKEN,
      });
      const res = await app.request(`/orders/${jobId}/refund`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, reason: "job_not_open" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a relay success reaches the client as 200", async () => {
    const paymentId = `0x${"ef".repeat(32)}` as Hex;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith(`/orders/${paymentId}`)) {
        return Response.json({
          id: paymentId,
          kind: "exact",
          status: "paid",
          customer: CUSTOMER,
          merchant: MERCHANT.address,
          amount: "2000000",
          refunded: "0",
        });
      }
      if (url.endsWith("/refund")) {
        return Response.json(
          { ok: true, txHash: `0x${"12".repeat(32)}`, refunded: "2000000" },
          { status: 200 },
        );
      }
      return Response.json({ ok: false, reason: "unexpected" }, { status: 500 });
    }) as typeof fetch;

    try {
      const app = createMerchantApp({
        merchant: MERCHANT,
        relayUrl: "http://relay.test",
        now: () => NOW,
        token: TOKEN,
      });
      const res = await app.request(`/orders/${paymentId}/refund`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, refunded: "2000000" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
