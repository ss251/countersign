import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import { parseAtomic } from "@countersign/core";
import { DEFAULT_MERCHANT_ORIGINS, loadMerchantConfig } from "./config.ts";
import { isRefundReason } from "./ledger.ts";
import type { RefundReason } from "./ledger.ts";
import { signRefund } from "./merchant.ts";
import { refundOrderWithStatus } from "./refund-client.ts";
import { WHITECHAIN_ESCROW } from "./whitechain-config.ts";
import type { Address } from "viem";

export type MerchantAppOptions = {
  merchant: LocalAccount;
  relayUrl: string;
  now?: () => number;
  /** The escrow whose jobs this merchant cancels. Defaults to the Whitechain deployment. */
  escrow?: Address;
  /** The bearer token every protected route requires. Without one every route fails closed. */
  token?: string;
  origins?: string[];
};

export function createMerchantApp(options: MerchantAppOptions): Hono {
  const { merchant, relayUrl } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const escrow = options.escrow ?? WHITECHAIN_ESCROW;
  const origins = options.origins ?? DEFAULT_MERCHANT_ORIGINS;
  const app = new Hono();

  // The merchant view is served from another origin (vite in development, static hosting after).
  app.use(
    "*",
    cors({
      origin: origins,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS" || c.req.path === "/me") return next();
    if (!authorized(c.req.header("Authorization"), options.token)) {
      return c.json({ ok: false, reason: "unauthorized" }, 401);
    }
    return next();
  });

  app.get("/me", (c) => c.json({ address: merchant.address }));

  app.get("/status", async () => proxy(`${relayUrl}/status`));

  app.get("/payments", async (c) => {
    return proxy(`${relayUrl}/payments?payTo=${encodeURIComponent(merchant.address)}`);
  });

  app.get("/payments.csv", async (c) => {
    return proxy(`${relayUrl}/payments.csv?payTo=${encodeURIComponent(merchant.address)}`);
  });

  app.get("/orders", async () => {
    return proxy(`${relayUrl}/orders?merchant=${encodeURIComponent(merchant.address)}`);
  });

  app.get("/orders.csv", async () => {
    return proxy(`${relayUrl}/orders.csv?merchant=${encodeURIComponent(merchant.address)}`);
  });

  app.post("/orders/:id/refund", async (c) => {
    const id = c.req.param("id");
    let body: unknown = {};
    const text = await c.req.text();
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return c.json({ ok: false, reason: "invalid_payload" }, 400);
      }
    }
    let amount: bigint | undefined;
    if (body && typeof body === "object" && "amount" in body) {
      const raw = (body as { amount: unknown }).amount;
      if (raw !== undefined) {
        if (typeof raw !== "string") return c.json({ ok: false, reason: "invalid_payload" }, 400);
        try {
          amount = parseAtomic(raw);
        } catch {
          return c.json({ ok: false, reason: "invalid_payload" }, 400);
        }
      }
    }
    let reason: RefundReason | undefined;
    if (body && typeof body === "object" && "reason" in body) {
      const raw = (body as { reason: unknown }).reason;
      if (raw !== undefined) {
        if (!isRefundReason(raw)) return c.json({ ok: false, reason: "invalid_payload" }, 400);
        reason = raw;
      }
    }

    const orderResponse = await fetch(`${relayUrl}/orders/${encodeURIComponent(id)}`);
    if (!orderResponse.ok) {
      return c.json({ ok: false, reason: "order_not_found" }, orderResponse.status === 404 ? 404 : 502);
    }
    const order = (await orderResponse.json()) as {
      id?: string;
      kind?: string;
      status?: string;
      customer?: string;
      merchant?: string;
      amount?: string;
      refunded?: string;
      escrow?: string;
    };
    if (!order.id || !order.merchant || !order.customer || !order.amount) {
      return c.json({ ok: false, reason: "order_not_found" }, 502);
    }

    const { reply, status } = await refundOrderWithStatus({
      relayUrl,
      merchant,
      order: {
        id: order.id,
        kind: order.kind ?? "",
        status: order.status ?? "",
        customer: order.customer,
        merchant: order.merchant,
        amount: order.amount,
        refunded: order.refunded ?? "0",
        ...(typeof order.escrow === "string" ? { escrow: order.escrow } : {}),
      },
      amount,
      reason,
      escrow,
      now,
    });
    return c.json(reply, status as ContentfulStatusCode);
  });

  app.post("/refund/:paymentId", async (c) => {
    const paymentId = c.req.param("paymentId");
    // One click sends no body: refund whatever is still refundable.
    let body: unknown = {};
    const text = await c.req.text();
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return c.json({ ok: false, reason: "invalid_payload" }, 400);
      }
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
    let reason: RefundReason | undefined;
    if (body && typeof body === "object" && "reason" in body) {
      const raw = (body as { reason: unknown }).reason;
      if (raw !== undefined) {
        if (!isRefundReason(raw)) return c.json({ ok: false, reason: "invalid_payload" }, 400);
        reason = raw;
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
      body: JSON.stringify({ paymentId, ...signed, ...(reason ? { reason } : {}) }),
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
  const app = createMerchantApp({
    merchant,
    relayUrl: config.relayUrl,
    token: config.token,
    origins: config.origins,
  });
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`merchant listening on ${config.port} as ${merchant.address}`);
}

function authorized(header: string | undefined, token: string | undefined): boolean {
  if (!token || typeof header !== "string") return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
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
