import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { createPublicClient, createWalletClient, fallback, http } from "viem";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "@countersign/core";
import { escrowAbi } from "@countersign/rail";
import { NETWORK, USDT, WHITECHAIN_CHAIN_ID, txUrl, whitechainSepolia } from "./chain.ts";
import { SpendCeiling } from "./ceiling.ts";
import { loadRelayConfig } from "./config.ts";
import { settleCountersign, verifyCountersign } from "./countersign-scheme.ts";
import type { CountersignContext } from "./countersign-scheme.ts";
import {
  acceptJob,
  cancelJob,
  disputeJob,
  failDeliveryJob,
  jobStatus,
  refundJob,
  releaseAfterWindowJob,
  releaseJob,
} from "./escrow-ops.ts";
import type { EscrowOpResult } from "./escrow-ops.ts";
import { settleExact, verifyExact } from "./exact.ts";
import type { ExactClock, ExactContext, VerifyRequest } from "./exact.ts";
import type { Authorization, WireAuthorization } from "./eip3009.ts";
import { isRefundReason, Ledger } from "./ledger.ts";
import type { RefundReason } from "./ledger.ts";
import { reconcileOrder } from "./reconcile.ts";
import { refundPayment } from "./refund.ts";
import { Relayer } from "./relayer.ts";
import type { ChainReader } from "./ports.ts";
import { WHITECHAIN_ESCROW } from "./whitechain-config.ts";

export type RelayAppConfig = {
  port?: number;
  relayUrl?: string;
  /** The bearer token /escrow/fail requires. Absent means the route answers 503. */
  hubToken?: string;
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
  const csCtx: CountersignContext = {
    chainClient: options.chainClient ?? reader,
    reader,
    relayer,
    ledger,
    now,
  };
  const app = new Hono();
  const hubToken = options.config?.hubToken;

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
      payees: status.policy.allowedPayees,
      minAmount: status.policy.minAmount.toString(),
      escrow: relayer.allowedEscrows[0] ?? WHITECHAIN_ESCROW,
      escrowV2: status.policy.escrowV2 ?? null,
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
      reason?: unknown;
    };
    if (
      !input ||
      typeof input.paymentId !== "string" ||
      !input.authorization ||
      typeof input.signature !== "string"
    ) {
      return c.json({ ok: false, reason: "invalid_payload" }, 400);
    }
    let reason: RefundReason | undefined;
    if (input.reason !== undefined) {
      if (!isRefundReason(input.reason)) {
        return c.json({ ok: false, reason: "invalid_payload" }, 400);
      }
      reason = input.reason;
    }
    const result = await refundPayment(
      {
        paymentId: input.paymentId,
        authorization: input.authorization as Authorization | WireAuthorization,
        signature: input.signature as `0x${string}`,
        reason,
      },
      ctx,
    );
    return c.json(jsonSafe(result));
  });

  app.get("/payments", (c) => {
    const payTo = c.req.query("payTo");
    const payer = c.req.query("payer");
    if (!payTo && !payer) {
      return c.json({ error: "filter_required" }, 400);
    }
    const payments = ledger.listPayments({ payTo, payer });
    return c.json({ payments: jsonSafe(payments) });
  });

  app.get("/payments.csv", (c) => {
    const payTo = c.req.query("payTo") ?? c.req.query("merchant");
    if (!payTo) {
      return c.json({ error: "filter_required" }, 400);
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
  const replyOp = (
    c: { json: (body: unknown, status: 200 | 404 | 409 | 422) => Response },
    result: EscrowOpResult,
  ) =>
    c.json(
      result,
      result.ok
        ? 200
        : result.reason === "job_not_found"
          ? 404
          : result.reason === "not_supported_on_v1"
            ? 409
            : 422,
    );

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
    let reason: RefundReason | undefined;
    if (v.reason !== undefined) {
      if (!isRefundReason(v.reason)) return bad(c);
      reason = v.reason;
    }
    return replyOp(
      c,
      await cancelJob({ jobId: v.jobId, sellerSig: v.sellerSig, reason }, csCtx),
    );
  });

  app.post("/escrow/refund", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId)) return bad(c);
    return replyOp(c, await refundJob({ jobId: v.jobId }, csCtx));
  });

  app.post("/escrow/accept", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId) || !isHexString(v.buyerSig)) return bad(c);
    return replyOp(c, await acceptJob({ jobId: v.jobId, buyerSig: v.buyerSig }, csCtx));
  });

  app.post("/escrow/dispute", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId) || !isHexString(v.buyerSig) || !isUint8(v.status)) return bad(c);
    return replyOp(
      c,
      await disputeJob({ jobId: v.jobId, status: v.status, buyerSig: v.buyerSig }, csCtx),
    );
  });

  app.post("/escrow/release-after-window", async (c) => {
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId)) return bad(c);
    return replyOp(c, await releaseAfterWindowJob({ jobId: v.jobId }, csCtx));
  });

  app.post("/escrow/fail", async (c) => {
    if (!hubToken) return c.json({ ok: false, reason: "fail_not_configured" }, 503);
    if (!authorizedHub(c.req.header("authorization"), hubToken)) {
      return c.json({ ok: false, reason: "hub_auth_required" }, 401);
    }
    const body = await readJson(c);
    const v = body.ok ? (body.value as Record<string, unknown> | null) : null;
    if (!v || !isHex32(v.jobId)) return bad(c);
    return replyOp(c, await failDeliveryJob({ jobId: v.jobId }, csCtx));
  });

  app.get("/escrow/jobs/:jobId", async (c) => {
    const view = await jobStatus(c.req.param("jobId"), csCtx);
    if (!view) return c.json({ error: "not_found" }, 404);
    return c.json(jsonSafe(view));
  });

  app.get("/orders", (c) => {
    const merchant = c.req.query("merchant");
    const customer = c.req.query("customer");
    if (!merchant && !customer) {
      return c.json({ error: "filter_required" }, 400);
    }
    const orders = ledger.listOrders({ merchant, customer });
    return c.json({ orders: jsonSafe(orders) });
  });

  app.get("/orders.csv", (c) => {
    const merchant = c.req.query("merchant") ?? c.req.query("payTo");
    if (!merchant) {
      return c.json({ error: "filter_required" }, 400);
    }
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="orders.csv"');
    return c.body(ledger.ordersCsv(merchant));
  });

  app.get("/orders/:id", async (c) => {
    const id = c.req.param("id");
    await reconcileOrder(id, ctx);
    const order = ledger.getOrder(id);
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


const tollBpsCache = new Map<string, number>();

async function tollBpsFor(reader: ChainReader, escrow: Address): Promise<number> {
  const key = escrow.toLowerCase();
  const cached = tollBpsCache.get(key);
  if (cached !== undefined) return cached;
  const value = await reader.readContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "tollBps",
  });
  const bps = Number(value);
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new Error(`invalid tollBps for ${escrow}`);
  }
  tollBpsCache.set(key, bps);
  return bps;
}

function schemeOf(body: unknown): unknown {
  const req = (body as { paymentRequirements?: { scheme?: unknown } } | null)?.paymentRequirements;
  return req && typeof req === "object" ? req.scheme : undefined;
}

function isHexString(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function authorizedHub(header: string | undefined, token: string): boolean {
  if (typeof header !== "string") return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const encoder = new TextEncoder();
  const provided = encoder.encode(header.slice(prefix.length));
  const expected = encoder.encode(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function isHex32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isUint8(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
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

// Started last, so every module-level binding above is initialised before startup code runs.
if (import.meta.main) {
  const config = loadRelayConfig(process.env);
  const account = privateKeyToAccount(config.relayerPrivateKey);
  // Fail closed on the wrong chain: rpc-testnet.whitechain.io answers as chain 2625 with zero balances.
  for (const url of config.rpcUrls) {
    const probe = createPublicClient({ chain: whitechainSepolia, transport: http(url) });
    const chainId = await probe.getChainId().catch(() => null);
    if (chainId !== WHITECHAIN_CHAIN_ID) {
      console.error(
        `relay refuses to start: ${url} is ${chainId === null ? "unreachable" : `chain ${chainId}`}, not ${WHITECHAIN_CHAIN_ID}`,
      );
      process.exit(1);
    }
  }
  const transport = fallback(config.rpcUrls.map((url) => http(url)));
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const walletClient = createWalletClient({ chain: whitechainSepolia, transport, account });
  const escrow = config.policy.allowedEscrows[0] ?? WHITECHAIN_ESCROW;
  const ledger = new Ledger(config.dbPath, { tollBps: await tollBpsFor(publicClient, escrow) });
  const ceiling = new SpendCeiling(config.ceiling);
  ceiling.seed(ledger.recentSpends(Date.now() - config.ceiling.windowMs));
  const relayer = new Relayer(publicClient, walletClient, account, config.policy, ceiling, (spend) =>
    ledger.recordSpend(spend),
  );
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
