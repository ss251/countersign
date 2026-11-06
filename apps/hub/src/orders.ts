import type { Context, Hono } from "hono";
import { explorerUrl, type Rail, type RailDeclaration } from "./deps.ts";
import type { JobRecord, JobStatus, Store } from "./store.ts";

export interface OrdersDeps {
  store: Store;
  rails: Rail[];
  relayUrl?: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const RELAY_TIMEOUT_MS = 3_000;

const NETWORK_NAMES: Record<string, string> = {
  "eip155:5042002": "Arc testnet",
  "eip155:1874": "Whitechain Sepolia",
  "hedera:testnet": "Hedera testnet",
  "mpp:tempo": "Tempo testnet",
};

export interface OrderAsset {
  symbol: string;
  decimals: number;
}

/** The merchant desk's order shape: the Whitechain relay's record plus the rail-neutral fields. */
export interface Order {
  id: string;
  kind: "escrow" | "exact";
  rail: string;
  network: string;
  networkName: string;
  asset: OrderAsset;
  explorer: string | null;
  customer: string;
  merchant: string;
  amount: string;
  fee: string;
  refunded: string;
  refundable: string;
  status: string;
  closeKind: string | null;
  createdAt: number;
  deadline: number;
  receivedAt: number | null;
  closedAt: number | null;
  settleTx: string | null;
  closeTx: string | null;
  refundTxs: string[];
  slipHash: string | null;
  offerHash: string;
  description: string | null;
  settleTxUrl: string | null;
  closeTxUrl: string | null;
  relayUnavailable?: true;
}

export interface Refund {
  amount: string;
  txHash: string;
  blockNumber: number;
  status: "pending" | "confirmed";
  reason: string | null;
  at: number | null;
}

export function registerOrders(app: Hono, deps: OrdersDeps): void {
  app.get("/orders", (c) => listOrders(c, deps));
  app.get("/orders/:id", (c) => getOrder(c, deps));
}

async function listOrders(c: Context, deps: OrdersDeps): Promise<Response> {
  const seller = c.req.query("seller");
  if (seller === undefined || !ADDRESS.test(seller)) {
    return fail(400, "bad-request", "Refused. Name the seller.");
  }
  const limit = parseLimit(c.req.query("limit"));
  const rails = new Map(deps.rails.map((rail) => [rail.declaration.id, rail]));
  const orders = await Promise.all(
    deps.store.listJobsBySeller(seller, limit).map((job) => orderWithRelay(job, deps, rails)),
  );
  return json({ orders });
}

async function getOrder(c: Context, deps: OrdersDeps): Promise<Response> {
  const id = c.req.param("id");
  const job = id === undefined ? null : deps.store.getJob(id);
  if (job === null) return notFound();
  const rails = new Map(deps.rails.map((rail) => [rail.declaration.id, rail]));
  const order = await orderFor(job, deps, rails);
  const refunds = await refundsFor(job, deps, order);
  return json({ ...order, refunds });
}

async function orderWithRelay(
  job: JobRecord,
  deps: OrdersDeps,
  rails: Map<string, Rail>,
): Promise<Order> {
  const order = await orderFor(job, deps, rails);
  if (job.rail !== "whitechain" || deps.relayUrl === undefined || deps.relayUrl === "") return order;
  const relay = await fetchRelayOrder(deps.relayUrl, job.jobId);
  if (relay === null) {
    order.relayUnavailable = true;
    return order;
  }
  applyRelay(order, relay);
  return order;
}

async function orderFor(job: JobRecord, deps: OrdersDeps, rails: Map<string, Rail>): Promise<Order> {
  const rail = rails.get(job.rail);
  const declaration = rail?.declaration;
  const offer = deps.store.getOffer(job.offerHash);
  const escrow = declaration?.kind === "escrow";
  const view = statusView(job.status, escrow);
  const createdMs = job.createdAt * 1000;
  const closedMs = job.closedAt === null || job.closedAt === undefined ? null : job.closedAt * 1000;
  const receivedAt =
    job.status === "released" && escrow
      ? closedMs
      : view.status === "paid" && !escrow
        ? createdMs
        : null;
  const order: Order = {
    id: job.jobId,
    kind: escrow ? "escrow" : "exact",
    rail: job.rail,
    network: job.payment.accepted.network,
    networkName: NETWORK_NAMES[job.payment.accepted.network] ?? job.payment.accepted.network,
    asset:
      declaration === undefined
        ? { symbol: "USDC", decimals: 6 }
        : { symbol: declaration.asset.symbol, decimals: declaration.asset.decimals },
    explorer: declaration === undefined ? null : explorerBase(declaration),
    customer: job.buyer,
    merchant: offer?.seller ?? job.payment.accepted.payTo,
    amount: job.amount,
    fee: await feeFor(job, rail, escrow),
    refunded: job.status === "refunded" ? job.amount : "0",
    refundable: "0",
    status: view.status,
    closeKind: view.closeKind,
    createdAt: createdMs,
    deadline: job.deadline * 1000,
    receivedAt,
    closedAt: closedMs,
    settleTx: job.settleTx,
    closeTx: job.closeTx,
    refundTxs: [],
    slipHash: job.slipHash,
    offerHash: job.offerHash,
    description: offer?.offer.title ?? null,
    settleTxUrl: txUrl(declaration, job.settleTx),
    closeTxUrl: txUrl(declaration, job.closeTx),
  };
  return order;
}

async function feeFor(job: JobRecord, rail: Rail | undefined, escrow: boolean): Promise<string> {
  if (job.status !== "released" || !escrow || rail?.escrow?.tollBps === undefined) return "0";
  try {
    const bps = await rail.escrow.tollBps();
    return ((BigInt(job.amount) * BigInt(bps)) / 10_000n).toString();
  } catch {
    return "0";
  }
}

function statusView(
  status: JobStatus,
  escrow: boolean,
): { status: string; closeKind: string | null } {
  switch (status) {
    case "funded":
      return { status: "held", closeKind: null };
    case "paid":
    case "settled":
    case "released":
      return { status: "paid", closeKind: status === "released" ? "release" : null };
    case "refunded":
      return { status: "refunded", closeKind: "deadline_refund" };
    case "failed":
      return escrow
        ? { status: "refund_pending", closeKind: null }
        : { status: "paid", closeKind: null };
    default:
      return { status: "pending", closeKind: null };
  }
}

async function refundsFor(job: JobRecord, deps: OrdersDeps, order: Order): Promise<unknown[]> {
  if (job.rail !== "whitechain" || deps.relayUrl === undefined || deps.relayUrl === "") return [];
  const relay = await fetchRelayOrder(deps.relayUrl, job.jobId);
  if (relay === null) {
    order.relayUnavailable = true;
    return [];
  }
  applyRelay(order, relay);
  return Array.isArray(relay.refunds) ? relay.refunds : [];
}

function applyRelay(order: Order, relay: Record<string, unknown>): void {
  if (typeof relay.fee === "string") order.fee = relay.fee;
  if (typeof relay.refunded === "string") order.refunded = relay.refunded;
  if (typeof relay.refundable === "string") order.refundable = relay.refundable;
  if (Array.isArray(relay.refundTxs) && relay.refundTxs.every((tx) => typeof tx === "string")) {
    order.refundTxs = relay.refundTxs;
  }
  if (typeof relay.status === "string") order.status = relay.status;
  if (relay.closeKind === null || typeof relay.closeKind === "string") order.closeKind = relay.closeKind;
}

async function fetchRelayOrder(relayUrl: string, jobId: string): Promise<Record<string, unknown> | null> {
  const base = relayUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${base}/orders/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    if (response.status !== 200) return null;
    const body: unknown = await response.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function explorerBase(declaration: RailDeclaration): string | null {
  const match = /^(.*)\/tx\/\{tx\}$/.exec(declaration.explorerTx);
  return match?.[1] ?? null;
}

function txUrl(declaration: RailDeclaration | undefined, tx: string | null): string | null {
  if (declaration === undefined || tx === null || declaration.explorerTx === "") return null;
  return explorerUrl(declaration, tx);
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notFound(): Response {
  return json({ code: "not_found" }, 404);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ code, message }, status);
}
