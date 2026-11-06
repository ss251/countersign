import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { recoverMessageAddress, type Hex } from "viem";
import {
  canonicalJson,
  explorerUrl,
  RAIL_IDS,
  type Envelope,
  type EnvelopeSpend,
  type Rail,
  type RailId,
} from "./deps.ts";
import type { ApprovalRecord, ApprovalStatus, Store } from "./store.ts";

export interface BuyerPlumbingDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
  humanApprovalToken?: string;
}

type EffectiveStatus = ApprovalStatus | "expired";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CLOCK_SKEW = 300;
const APPROVAL_TTL = 15 * 60;

export function registerBuyerPlumbing(app: Hono, deps: BuyerPlumbingDeps): void {
  app.get("/jobs", (c) => listJobs(c, deps));

  app.put("/envelopes/:agent", async (c) => putEnvelope(c, deps));
  app.get("/envelopes/:agent", (c) => getEnvelope(c, deps));

  app.post("/approvals", async (c) => createApproval(c, deps));
  app.get("/approvals", (c) => listApprovals(c, deps));
  app.get("/approvals/:id", (c) => getApproval(c, deps));
  app.post("/approvals/:id/decision", async (c) => decideApproval(c, deps));
}

function listJobs(c: Context, deps: BuyerPlumbingDeps): Response {
  const buyer = c.req.query("buyer");
  if (buyer === undefined || buyer.trim() === "") {
    return fail(400, "bad-request", "Refused. Name the buyer.");
  }
  const limit = parseLimit(c.req.query("limit"));
  const rails = new Map(deps.rails.map((rail) => [rail.declaration.id, rail]));
  const jobs = deps.store.listJobsByBuyer(buyer, limit).map((job) => {
    const slip = job.slipHash === null ? null : deps.store.getSlip(job.slipHash);
    let explorer: string | null = null;
    if (slip?.settlement.url !== undefined) {
      explorer = slip.settlement.url;
    } else {
      const rail = rails.get(job.rail);
      const tx = job.closeTx ?? job.settleTx;
      if (rail !== undefined && rail.declaration.explorerTx !== "" && tx !== null) {
        explorer = explorerUrl(rail.declaration, tx);
      }
    }
    return {
      jobId: job.jobId,
      offerHash: job.offerHash,
      title: deps.store.getOffer(job.offerHash)?.offer.title ?? "",
      amount: job.amount,
      rail: job.rail,
      network: job.payment.accepted.network,
      status: job.status,
      at: job.createdAt,
      settleTx: job.settleTx,
      closeTx: job.closeTx,
      slipHash: job.slipHash,
      explorer,
    };
  });
  return json({ jobs });
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, value));
}

async function putEnvelope(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const agentParam = c.req.param("agent");
  if (agentParam === undefined || agentParam === "") {
    return fail(400, "bad-request", "Refused. Name the agent.");
  }
  const body = await readJson(c);
  if (!isRecord(body)) return fail(400, "bad-request", "Refused. The mirror is malformed.");

  const { envelope, spent, signedAt, sig } = body;
  if (
    !isRecord(envelope) ||
    typeof envelope.agent !== "string" ||
    !isRecord(spent) ||
    !Number.isSafeInteger(signedAt) ||
    typeof sig !== "string"
  ) {
    return fail(400, "bad-request", "Refused. The mirror is malformed.");
  }

  let message: string;
  try {
    message = canonicalJson({ envelope, spent, signedAt });
  } catch {
    return fail(400, "bad-request", "Refused. The mirror is malformed.");
  }
  const signer = await recover(message, sig);
  if (
    signer === null ||
    signer.toLowerCase() !== agentParam.toLowerCase() ||
    signer.toLowerCase() !== envelope.agent.toLowerCase()
  ) {
    return fail(401, "bad-signature", "Refused. The mirror signature is not the agent's.");
  }

  const now = deps.now();
  const at = signedAt as number;
  if (Math.abs(now - at) > CLOCK_SKEW) {
    return fail(409, "stale-envelope", "Refused. The mirror is not fresh.");
  }
  const stored = deps.store.getEnvelopeMirror(agentParam);
  if (stored !== null && at <= stored.signedAt) {
    return fail(409, "stale-envelope", "Refused. A newer mirror is already stored.");
  }

  deps.store.putEnvelopeMirror({
    agent: agentParam,
    envelope: envelope as unknown as Envelope,
    spent: spent as unknown as EnvelopeSpend,
    signedAt: at,
    sig: sig as Hex,
  });
  return json({ ok: true });
}

function getEnvelope(c: Context, deps: BuyerPlumbingDeps): Response {
  const agent = c.req.param("agent");
  if (agent === undefined || agent === "") {
    return fail(400, "bad-request", "Refused. Name the agent.");
  }
  const stored = deps.store.getEnvelopeMirror(agent);
  if (stored === null) return fail(404, "unknown-agent", "Refused. That agent has no mirror here.");
  return json({
    envelope: stored.envelope,
    spent: stored.spent,
    signedAt: stored.signedAt,
    sig: stored.sig,
    verified: true,
  });
}

async function createApproval(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const body = await readJson(c);
  if (!isRecord(body)) return fail(400, "bad-request", "Refused. The approval is malformed.");

  const { agent, offerHash, title, amount, rail, terms, requestedAt, sig } = body;
  if (
    typeof agent !== "string" ||
    typeof offerHash !== "string" ||
    typeof title !== "string" ||
    typeof amount !== "string" ||
    typeof rail !== "string" ||
    terms === undefined ||
    !Number.isSafeInteger(requestedAt) ||
    typeof sig !== "string"
  ) {
    return fail(400, "bad-request", "Refused. The approval is malformed.");
  }
  if (!RAIL_IDS.includes(rail as RailId)) {
    return fail(400, "bad-request", "Refused. The approval names an unknown rail.");
  }

  const at = requestedAt as number;
  let message: string;
  try {
    message = canonicalJson({ agent, offerHash, title, amount, rail, terms, requestedAt: at });
  } catch {
    return fail(400, "bad-request", "Refused. The approval is malformed.");
  }
  const signer = await recover(message, sig);
  if (signer === null || signer.toLowerCase() !== agent.toLowerCase()) {
    return fail(401, "bad-signature", "Refused. The approval signature is not the agent's.");
  }
  if (Math.abs(deps.now() - at) > CLOCK_SKEW) {
    return fail(409, "stale-approval", "Refused. The approval request is not fresh.");
  }

  const id = randomBytes(16).toString("hex");
  deps.store.putApproval({
    id,
    agent,
    offerHash: offerHash as Hex,
    title,
    amount,
    rail: rail as RailId,
    terms,
    status: "pending",
    createdAt: at,
    decidedAt: null,
  });
  return json({ id }, 201);
}

function listApprovals(c: Context, deps: BuyerPlumbingDeps): Response {
  const agent = c.req.query("agent");
  const filter = c.req.query("status") ?? "pending";
  if (filter !== "pending" && filter !== "decided" && filter !== "all") {
    return fail(400, "bad-request", "Refused. Unknown approval status.");
  }
  const now = deps.now();
  const approvals = deps.store
    .listApprovals(agent === undefined || agent === "" ? undefined : agent)
    .map((row) => view(row, now))
    .filter((row) => {
      if (filter === "all") return true;
      if (filter === "pending") return row.status === "pending";
      return row.status === "countersign" || row.status === "decline";
    });
  return json({ approvals });
}

function getApproval(c: Context, deps: BuyerPlumbingDeps): Response {
  const id = c.req.param("id");
  const row = id === undefined ? null : deps.store.getApproval(id);
  if (row === null) return fail(404, "unknown-approval", "Refused. That approval is not known.");
  return json(view(row, deps.now()));
}

async function decideApproval(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const expected = deps.humanApprovalToken;
  if (expected === undefined || expected === "") {
    return fail(503, "no-approver", "Refused. No human approver is configured.");
  }
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (match === null || !sameToken(match[1] ?? "", expected)) {
    return fail(401, "unauthorized", "Refused. The approver token is not valid.");
  }

  const id = c.req.param("id");
  const row = id === undefined ? null : deps.store.getApproval(id);
  if (row === null) return fail(404, "unknown-approval", "Refused. That approval is not known.");
  const now = deps.now();
  const status = effectiveStatus(row, now);
  if (status === "expired") return fail(409, "expired", "Refused. This approval has expired.");
  if (status !== "pending") return fail(409, "already-decided", "Refused. This approval is already decided.");

  const body = await readJson(c);
  if (!isRecord(body)) return fail(400, "bad-request", "Refused. The decision is malformed.");
  const decision = body.decision;
  if (decision !== "countersign" && decision !== "decline") {
    return fail(400, "bad-request", "Refused. The decision is not countersign or decline.");
  }

  if (!deps.store.decideApproval(row.id, decision, now)) {
    return fail(409, "already-decided", "Refused. This approval is already decided.");
  }
  return json({ ok: true });
}

function effectiveStatus(row: ApprovalRecord, now: number): EffectiveStatus {
  if (row.status === "pending" && now - row.createdAt > APPROVAL_TTL) return "expired";
  return row.status;
}

function view(row: ApprovalRecord, now: number): {
  id: string;
  agent: string;
  offerHash: Hex;
  title: string;
  amount: string;
  rail: RailId;
  terms: unknown;
  status: EffectiveStatus;
  createdAt: number;
  requestedAt: number;
  decidedAt: number | null;
} {
  return {
    id: row.id,
    agent: row.agent,
    offerHash: row.offerHash,
    title: row.title,
    amount: row.amount,
    rail: row.rail,
    terms: row.terms,
    status: effectiveStatus(row, now),
    createdAt: row.createdAt,
    requestedAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

async function recover(message: string, sig: string): Promise<string | null> {
  try {
    return await recoverMessageAddress({ message, signature: sig as Hex });
  } catch {
    return null;
  }
}

function sameToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
