import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "@countersign/core";
import { NETWORK, txUrl, whitechainSepolia } from "./chain.ts";
import { SpendCeiling } from "./ceiling.ts";
import { loadRelayConfig } from "./config.ts";
import { settleExact, verifyExact } from "./exact.ts";
import type { ExactClock, ExactContext, VerifyRequest } from "./exact.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";
import { Ledger } from "./ledger.ts";
import { refundPayment } from "./refund.ts";
import { Relayer } from "./relayer.ts";
import type { ChainReader } from "./ports.ts";

export type RelayAppConfig = {
  port?: number;
  relayUrl?: string;
};

export type RelayAppOptions = {
  reader: ChainReader;
  relayer: Relayer;
  ledger: Ledger;
  now: ExactClock;
  config?: RelayAppConfig;
};

export function createRelayApp(options: RelayAppOptions): Hono {
  const { reader, relayer, ledger, now } = options;
  const ctx: ExactContext = { reader, relayer, ledger, now };
  const app = new Hono();

  app.use("*", cors({ origin: "*" }));

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/status", async (c) => {
    const status = await relayer.status();
    return c.json({
      address: status.address,
      balanceWei: status.balanceWei.toString(),
      balanceWbt: formatUnits(status.balanceWei, 18),
      ceiling: jsonSafe(status.ceiling),
      policy: jsonSafe(status.policy),
    });
  });

  app.get("/supported", (c) =>
    c.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
      extensions: [],
      signers: { "eip155:*": [relayer.address] },
    }),
  );

  app.post("/verify", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json({ isValid: false, invalidReason: "invalid_payload" }, 400);
    }
    return c.json(await verifyExact(body.value as VerifyRequest, ctx));
  });

  app.post("/settle", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json(
        {
          success: false,
          errorReason: "invalid_payload",
          transaction: "",
          network: NETWORK,
        },
        400,
      );
    }
    return c.json(await settleExact(body.value as VerifyRequest, ctx));
  });

  app.post("/refund", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json({ ok: false, reason: "invalid_payload" }, 400);
    }
    const input = body.value as {
      paymentId?: unknown;
      authorization?: unknown;
      signature?: unknown;
    };
    if (
      !input ||
      typeof input.paymentId !== "string" ||
      !input.authorization ||
      typeof input.signature !== "string"
    ) {
      return c.json({ ok: false, reason: "invalid_payload" }, 400);
    }
    const result = await refundPayment(
      {
        paymentId: input.paymentId,
        authorization: input.authorization as Authorization | WireAuthorization,
        signature: input.signature as `0x${string}`,
      },
      ctx,
    );
    return c.json(jsonSafe(result));
  });

  app.get("/payments", (c) => {
    const payments = ledger.listPayments({
      payTo: c.req.query("payTo"),
      payer: c.req.query("payer"),
    });
    return c.json({ payments: jsonSafe(payments) });
  });

  app.get("/payments.csv", (c) => {
    const payTo = c.req.query("payTo");
    if (!payTo) {
      return c.json({ error: "payTo_required" }, 400);
    }
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="payments.csv"');
    return c.body(ledger.toCsv(payTo));
  });

  app.get("/payments/:id", (c) => {
    const payment = ledger.getPayment(c.req.param("id"));
    if (!payment) {
      return c.json({ error: "not_found" }, 404);
    }
    const refunds = ledger.listRefunds(payment.id);
    return c.json({
      ...(jsonSafe(payment) as Record<string, unknown>),
      refunds: jsonSafe(refunds),
      settleTxUrl: txUrl(payment.txHash),
      refundTxUrls: refunds.map((refund) => txUrl(refund.txHash)),
    });
  });

  return app;
}

if (import.meta.main) {
  const config = loadRelayConfig(process.env);
  const account = privateKeyToAccount(config.relayerPrivateKey);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const walletClient = createWalletClient({ chain: whitechainSepolia, transport, account });
  const ledger = new Ledger(config.dbPath);
  const ceiling = new SpendCeiling(config.ceiling);
  const relayer = new Relayer(publicClient, walletClient, account, config.policy, ceiling);
  const app = createRelayApp({
    reader: publicClient,
    relayer,
    ledger,
    now: () => Math.floor(Date.now() / 1000),
    config,
  });
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(`relay listening on ${config.port} as ${account.address}`);
}

async function readJson(
  c: { req: { json: () => Promise<unknown> } },
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}
