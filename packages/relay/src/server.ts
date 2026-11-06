import { Hono } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "@countersign/core";
import { NETWORK, USDT, WHITECHAIN_CHAIN_ID, txUrl, whitechainSepolia } from "./chain.ts";
import { SpendCeiling } from "./ceiling.ts";
import { loadRelayConfig } from "./config.ts";
import { settleCountersign, verifyCountersign } from "./countersign-scheme.ts";
import type { CountersignContext } from "./countersign-scheme.ts";
import { cancelJob, jobStatus, refundJob, releaseJob } from "./escrow-ops.ts";
import type { EscrowOpResult } from "./escrow-ops.ts";
import { settleExact, verifyExact } from "./exact.ts";
import type { ExactClock, ExactContext, VerifyRequest } from "./exact.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";
import { Ledger } from "./ledger.ts";
import { refundPayment } from "./refund.ts";
import { Relayer } from "./relayer.ts";
import type { ChainReader } from "./ports.ts";
import { WHITECHAIN_ESCROW } from "./whitechain-config.ts";

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
  /** The client escrowRail reads through. Defaults to the reader. */
  chainClient?: unknown;
};

export function createRelayApp(options: RelayAppOptions): Hono {
  const { reader, relayer, ledger, now } = options;
  const ctx: ExactContext = { reader, relayer, ledger, now };
  const csCtx: CountersignContext = { chainClient: options.chainClient ?? reader, relayer, ledger, now };
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
      escrow: relayer.allowedEscrows[0] ?? WHITECHAIN_ESCROW,
      token: USDT.address,
      network: NETWORK,
      chainId: WHITECHAIN_CHAIN_ID,
    });
  });

  app.get("/supported", (c) =>
    c.json({
      kinds: [
        { x402Version: 2, scheme: "exact", network: NETWORK },
        { x402Version: 2, scheme: "countersign", network: NETWORK },
      ],
      extensions: [],
      signers: { "eip155:*": [relayer.address] },
    }),
  );

  app.post("/verify", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return c.json({ isValid: false, invalidReason: "invalid_payload" }, 400);
    }
    if (schemeOf(body.value) === "countersign") {
      return c.json(await verifyCountersign(body.value, csCtx));
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
    if (schemeOf(body.value) === "countersign") {
      return c.json(await settleCountersign(body.value, csCtx));
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

  const bad = (c: { json: (body: unknown, status: 400) => Response }) =>
    c.json({ ok: false, reason: "invalid_payload" }, 400);
  const replyOp = (c: { json: (body: unknown, status: 200 | 404 | 422) => Response }, result: EscrowOpResult) =>
    c.json(result, result.ok ? 200 : result.reason === "job_not_found" ? 404 : 422);

  app.post("/escrow/release", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId) || !isHex32(v.slipHash) || !isHexString(v.sellerSig)) return bad(c);
    return replyOp(
      c,
      await releaseJob({ jobId: v.jobId, slipHash: v.slipHash, sellerSig: v.sellerSig }, csCtx),
    );
  });

  app.post("/escrow/cancel", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId) || !isHexString(v.sellerSig)) return bad(c);
    return replyOp(c, await cancelJob({ jobId: v.jobId, sellerSig: v.sellerSig }, csCtx));
  });

  app.post("/escrow/refund", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId)) return bad(c);
    return replyOp(c, await refundJob({ jobId: v.jobId }, csCtx));
  });

  app.get("/escrow/jobs/:jobId", async (c) => {
    const view = await jobStatus(c.req.param("jobId"), csCtx);
    if (!view) return c.json({ error: "not_found" }, 404);
    return c.json(jsonSafe(view));
  });

  app.get("/orders", (c) => {
    const orders = ledger.listOrders({
      merchant: c.req.query("merchant"),
      customer: c.req.query("customer"),
    });
    return c.json({ orders: jsonSafe(orders) });
  });

  app.get("/orders.csv", (c) => {
    const merchant = c.req.query("merchant");
    if (!merchant) {
      return c.json({ error: "merchant_required" }, 400);
    }
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="orders.csv"');
    return c.body(ledger.ordersCsv(merchant));
  });

  app.get("/orders/:id", (c) => {
    const order = ledger.getOrder(c.req.param("id"));
    if (!order) {
      return c.json({ error: "not_found" }, 404);
    }
    const refunds = ledger.listRefunds(order.id);
    return c.json({
      ...(jsonSafe(order) as Record<string, unknown>),
      refunds: jsonSafe(refunds),
      settleTxUrl: txUrl(order.settleTx),
      closeTxUrl: order.closeTx ? txUrl(order.closeTx) : null,
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
  // Fail closed on the wrong chain: rpc-testnet.whitechain.io answers as chain 2625 with zero balances.
  const chainId = await publicClient.getChainId();
  if (chainId !== WHITECHAIN_CHAIN_ID) {
    console.error(`relay refuses to start: ${config.rpcUrl} is chain ${chainId}, not ${WHITECHAIN_CHAIN_ID}`);
    process.exit(1);
  }
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

function schemeOf(body: unknown): unknown {
  const req = (body as { paymentRequirements?: { scheme?: unknown } } | null)?.paymentRequirements;
  return req && typeof req === "object" ? req.scheme : undefined;
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
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
