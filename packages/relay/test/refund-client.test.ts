import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { refundOrder } from "../src/refund-client.ts";
import type { RefundOrderView } from "../src/refund-client.ts";

const MERCHANT = privateKeyToAccount(generatePrivateKey());
const CUSTOMER = getAddress("0x1111111111111111111111111111111111111111");
const OTHER = getAddress("0x2222222222222222222222222222222222222222");
const JOB = `0x${"ab".repeat(32)}` as Hex;
const NOW = 1_760_000_000;
const UNKNOWN =
  "The refund may have been sent. Reload to see whether it settled before refunding again.";

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

function wire(reply: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return reply();
  }) as typeof fetch;
  return { send, calls };
}

describe("refundOrder", () => {
  test("cancels a held escrow order for its whole amount", async () => {
    const { send, calls } = wire(() =>
      Response.json({ ok: true, transaction: `0x${"cd".repeat(32)}`, status: "cancelled" }),
    );
    const result = await refundOrder({
      relayUrl: "http://relay.test/",
      merchant: MERCHANT,
      order: order({ kind: "escrow", status: "held", amount: "1500000" }),
      amount: 1_500_000n,
      reason: "requested_by_customer",
      now: () => NOW,
      fetch: send,
    });

    expect(result).toEqual({
      ok: true,
      transaction: `0x${"cd".repeat(32)}`,
      status: "cancelled",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://relay.test/escrow/cancel");
    expect(calls[0]!.body).toMatchObject({
      jobId: JOB,
      reason: "requested_by_customer",
    });
    expect(calls[0]!.body.sellerSig).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  test("refuses a partial cancel of a held escrow order", async () => {
    const { send, calls } = wire(() => Response.json({ ok: true }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order({ kind: "escrow", status: "held", amount: "1500000" }),
      amount: 750_000n,
      fetch: send,
    });

    expect(result).toEqual({ ok: false, reason: "partial_cancel_not_possible" });
    expect(calls).toHaveLength(0);
  });

  test("refunds a paid order", async () => {
    const { send, calls } = wire(() =>
      Response.json({ ok: true, txHash: `0x${"ef".repeat(32)}`, refunded: "2000000" }),
    );
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      now: () => NOW,
      fetch: send,
    });

    expect(result).toEqual({ ok: true, txHash: `0x${"ef".repeat(32)}`, refunded: "2000000" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://relay.test/refund");
    expect(calls[0]!.body).toMatchObject({
      paymentId: JOB,
      authorization: {
        from: MERCHANT.address,
        to: CUSTOMER,
        value: "2000000",
        validAfter: "0",
      },
    });
    expect(calls[0]!.body.signature).toMatch(/^0x[0-9a-fA-F]+$/);
  });

  test("refunds part of a paid order", async () => {
    const { send, calls } = wire(() => Response.json({ ok: true, txHash: `0x${"ef".repeat(32)}` }));
    await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      amount: 500_000n,
      reason: "duplicate",
      now: () => NOW,
      fetch: send,
    });

    expect(calls[0]!.body).toMatchObject({
      paymentId: JOB,
      authorization: { value: "500000" },
      reason: "duplicate",
    });
  });

  test("refuses another merchant's order", async () => {
    const { send, calls } = wire(() => Response.json({ ok: true }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order({ merchant: OTHER }),
      fetch: send,
    });

    expect(result).toEqual({ ok: false, reason: "not_your_order" });
    expect(calls).toHaveLength(0);
  });

  test("refuses a closed order", async () => {
    const { send, calls } = wire(() => Response.json({ ok: true }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order({ status: "cancelled" }),
      fetch: send,
    });

    expect(result).toEqual({ ok: false, reason: "not_refundable" });
    expect(calls).toHaveLength(0);
  });

  test("refuses an amount that cannot be signed", async () => {
    const { send, calls } = wire(() => Response.json({ ok: true }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order({ amount: "2000000", refunded: "1500000" }),
      amount: 1_000_000n,
      now: () => NOW,
      fetch: send,
    });

    expect(result).toEqual({ ok: false, reason: "refund_not_possible" });
    expect(calls).toHaveLength(0);
  });

  test("a network error is unknown", async () => {
    const send = (async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      now: () => NOW,
      fetch: send,
    });
    expect(result).toEqual({ ok: "unknown", reason: UNKNOWN });
  });

  test("a 502 is unknown", async () => {
    const { send } = wire(() => new Response("bad gateway", { status: 502 }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      now: () => NOW,
      fetch: send,
    });
    expect(result).toEqual({ ok: "unknown", reason: UNKNOWN });
  });

  test("a non-JSON body is unknown", async () => {
    const { send } = wire(() => new Response("not json", { status: 200 }));
    const result = await refundOrder({
      relayUrl: "http://relay.test",
      merchant: MERCHANT,
      order: order(),
      now: () => NOW,
      fetch: send,
    });
    expect(result).toEqual({ ok: "unknown", reason: UNKNOWN });
  });
});
