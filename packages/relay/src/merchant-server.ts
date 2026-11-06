import { Hono } from "hono";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import { parseAtomic } from "@countersign/core";
import { loadMerchantConfig } from "./config.ts";
import { signRefund } from "./merchant.ts";

export type MerchantAppOptions = {
  merchant: LocalAccount;
  relayUrl: string;
  now?: () => number;
};

export function createMerchantApp(options: MerchantAppOptions): Hono {
  const { merchant, relayUrl } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono();

  app.get("/me", (c) => c.json({ address: merchant.address }));

  app.get("/payments", async (c) => {
    return proxy(`${relayUrl}/payments?payTo=${encodeURIComponent(merchant.address)}`);
  });

  app.get("/payments.csv", async (c) => {
    return proxy(`${relayUrl}/payments.csv?payTo=${encodeURIComponent(merchant.address)}`);
  });

  app.post("/refund/:paymentId", async (c) => {
    const paymentId = c.req.param("paymentId");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, reason: "invalid_payload" }, 400);
    }

    let amount: bigint | undefined;
    if (body && typeof body === "object" && "amount" in body) {
      const raw = (body as { amount: unknown }).amount;
      if (raw !== undefined) {
        if (typeof raw !== "string") {
          return c.json({ ok: false, reason: "invalid_payload" }, 400);
        }
        try {
          amount = parseAtomic(raw);
        } catch {
          return c.json({ ok: false, reason: "invalid_payload" }, 400);
        }
      }
    }

    const paymentResponse = await fetch(
      `${relayUrl}/payments/${encodeURIComponent(paymentId)}`,
    );
    if (!paymentResponse.ok) {
      return c.json(
        { ok: false, reason: "payment_not_found" },
        paymentResponse.status === 404 ? 404 : 502,
      );
    }
    const payment = (await paymentResponse.json()) as {
      payer?: string;
      payTo?: string;
      amount?: string;
      refunded?: string;
      status?: string;
    };
    if (!payment.payer || !payment.payTo || !payment.amount) {
      return c.json({ ok: false, reason: "payment_not_found" }, 502);
    }

    let signed;
    try {
      signed = await signRefund({
        merchant,
        payment: {
          payer: getAddress(payment.payer),
          payTo: getAddress(payment.payTo),
          amount: parseAtomic(payment.amount),
          refunded: parseAtomic(payment.refunded ?? "0"),
        },
        amount,
        now: now(),
      });
    } catch {
      return c.json({ ok: false, reason: "refund_not_possible" }, 400);
    }

    const refundResponse = await fetch(`${relayUrl}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId, ...signed }),
    });
    return new Response(await refundResponse.text(), {
      status: refundResponse.status,
      headers: { "content-type": "application/json" },
    });
  });

  return app;
}

if (import.meta.main) {
  const config = loadMerchantConfig(process.env);
  const merchant = privateKeyToAccount(config.merchantPrivateKey);
  const app = createMerchantApp({ merchant, relayUrl: config.relayUrl });
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`merchant listening on ${config.port} as ${merchant.address}`);
}

async function proxy(url: string): Promise<Response> {
  const response = await fetch(url);
  return new Response(await response.text(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
