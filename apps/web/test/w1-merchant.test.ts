import { describe, expect, test } from "bun:test";
import { refundOrder, unlockRefunds } from "../src/routes/merchant/api.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// The desk's one-click refund (Desk.tsx sendRefund) shows "Refund <order.refundable>", waits out the
// undo window, then calls refundOrder(order.id) with no amount. The merchant service then signs
// whatever its relay says is left, which need not be the figure the merchant confirmed: the figure
// came from whichever hub this console reads (?hub= is remembered), the money from the relay.

describe("W1 B15: a refund signs an amount the merchant never saw", () => {
  test("no refund request leaves the console without the amount the merchant confirmed", async () => {
    const real = globalThis.fetch;
    const refundBodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/orders")) return Response.json([]); // the token check in unlockRefunds
      if (url.includes("/refund")) {
        refundBodies.push(String(init?.body ?? ""));
        return Response.json({ ok: true, txHash: `0x${"11".repeat(32)}`, refunded: "500000000" });
      }
      throw new TypeError("network down");
    }) as typeof fetch;
    try {
      await unlockRefunds("w1-token");
      // The desk showed this order as refundable 0.01 USDT; the one-click path sends exactly this call.
      await refundOrder("0x01").catch(() => undefined);
      for (const body of refundBodies) {
        expect((JSON.parse(body) as { amount?: unknown }).amount).toBeDefined();
      }
    } finally {
      globalThis.fetch = real;
    }
  });
});
