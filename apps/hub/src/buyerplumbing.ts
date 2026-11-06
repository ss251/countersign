import { reviewFields } from "./orders.ts";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono } from "hono";
import { recoverMessageAddress, type Hex } from "viem";
import {
  approvalDecisionBody,
  approvalDecisionSigner,
  approvalRequestHash,
  canonicalJson,
  explorerUrl,
  RAIL_IDS,
  type ApprovalRequest,
  type Envelope,
  type EnvelopeSpend,
  type Rail,
  type RailId,
} from "./deps.ts";
import { owns, personFrom, type PrivyVerifier } from "./privy.ts";
import type { ApprovalRecord, ApprovalStatus, Store } from "./store.ts";

export interface BuyerPlumbingDeps {
  store: Store;
  rails: Rail[];
  now: () => number;
  humanApprovalToken?: string;
  /** Privy access-token verifier. Without it, the Privy header is ignored. */
  privy?: PrivyVerifier;
}

type EffectiveStatus = ApprovalStatus | "expired";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CLOCK_SKEW = 300;
const APPROVAL_TTL = 15 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PENDING_APPROVALS = 20;

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
  const rawBuyer = c.req.query("buyer");
  const rawSeller = c.req.query("seller");
  const buyer = rawBuyer === undefined || rawBuyer.trim() === "" ? null : rawBuyer;
  const seller = rawSeller === undefined || rawSeller.trim() === "" ? null : rawSeller;
  const rails = new Map(deps.rails.map((rail) => [rail.declaration.id, rail]));
  let records: ReturnType<Store["listJobsByBuyer"]>;
  if (buyer !== null && seller === null) {
    records = deps.store.listJobsByBuyer(buyer, parseLimit(c.req.query("limit")));
  } else if (seller !== null && buyer === null) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(seller)) {
      return fail(400, "bad-request", "Refused. Name the seller.");
    }
    records = deps.store.listJobsBySeller(seller, parseLimit(c.req.query("limit")));
  } else {
    return fail(400, "bad-request", "Refused. Name the buyer or the seller.");
  }
  const jobs = records.map((job) => {
    const slip = job.slipHash === null ? null : deps.store.getSlip(job.slipHash);
    const offer = deps.store.getOffer(job.offerHash);
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
      title: offer?.offer.title ?? "",
      amount: job.amount,
      rail: job.rail,
      network: job.payment.accepted.network,
      status: job.status,
      at: job.createdAt,
      buyer: job.buyer,
      seller: offer?.seller ?? job.payment.accepted.payTo,
      settleTx: job.settleTx,
      closeTx: job.closeTx,
      slipHash: job.slipHash,
      explorer,
      ...reviewFields(job, rails.get(job.rail)?.declaration.kind === "escrow"),
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
  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return fail(413, "too-large", "Refused. The request body is too large.");
  if (parsed.kind === "malformed") return fail(400, "bad-request", "Refused. The mirror is malformed.");
  const body = parsed.value;
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

async function getEnvelope(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
  if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
  if (privyCheck.kind === "none") {
    const refused = requireToken(c, deps);
    if (refused) return refused;
  }
  const agent = c.req.param("agent");
  if (agent === undefined || agent === "") {
    return fail(400, "bad-request", "Refused. Name the agent.");
  }
  const stored = deps.store.getEnvelopeMirror(agent);
  if (stored === null) return fail(404, "unknown-agent", "Refused. That agent has no mirror here.");
  if (privyCheck.kind === "person") {
    const approver = deps.store.getEnvelopeMirror(agent)?.envelope.approver;
    if (!owns(privyCheck.person, approver)) {
      return fail(403, "not-your-agent", "Refused. This agent's approver key is not one of your wallets.");
    }
  }
  return json({
    envelope: stored.envelope,
    spent: stored.spent,
    signedAt: stored.signedAt,
    sig: stored.sig,
    verified: true,
  });
}

async function createApproval(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const parsed = await readJsonLimited(c);
  if (parsed.kind === "too-large") return fail(413, "too-large", "Refused. The request body is too large.");
  if (parsed.kind === "malformed") return fail(400, "bad-request", "Refused. The approval is malformed.");
  const body = parsed.value;
  if (!isRecord(body)) return fail(400, "bad-request", "Refused. The approval is malformed.");

  const { agent, offerHash, title, amount, rail, terms, requestedAt, nonce, sig } = body;
  if (
    typeof agent !== "string" ||
    typeof offerHash !== "string" ||
    typeof title !== "string" ||
    typeof amount !== "string" ||
    typeof rail !== "string" ||
    terms === undefined ||
    !Number.isSafeInteger(requestedAt) ||
    typeof nonce !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(nonce) ||
    typeof sig !== "string"
  ) {
    return fail(400, "bad-request", "Refused. The approval is malformed.");
  }
  if (!RAIL_IDS.includes(rail as RailId)) {
    return fail(400, "bad-request", "Refused. The approval names an unknown rail.");
  }

  const at = requestedAt as number;
  const request: ApprovalRequest = {
    agent,
    offerHash,
    title,
    amount,
    rail,
    terms,
    requestedAt: at,
    nonce: nonce as Hex,
  };
  let message: string;
  try {
    message = canonicalJson(request);
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
  if (deps.store.getEnvelopeMirror(agent) === null) {
    return fail(
      409,
      "unknown-agent",
      "Refused. Publish this agent's envelope before asking for approvals.",
    );
  }
  if (deps.store.hasApprovalRequestSig(sig)) {
    return fail(409, "duplicate-request", "Refused. This approval request was already received.");
  }
  if (
    deps.store.countPendingApprovals(agent, deps.now() - APPROVAL_TTL) >= MAX_PENDING_APPROVALS
  ) {
    return fail(429, "too-many-pending", "Refused. This agent has too many pending approvals.");
  }

  const id = randomBytes(16).toString("hex");
  if (
    !deps.store.putApproval({
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
      request,
      requestSig: sig,
      decisionSig: null,
    })
  ) {
    return fail(409, "duplicate-request", "Refused. This approval request was already received.");
  }
  return json({ id }, 201);
}

async function listApprovals(c: Context, deps: BuyerPlumbingDeps): Promise<Response> {
  const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
  if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
  if (privyCheck.kind === "none") {
    const refused = requireToken(c, deps);
    if (refused) return refused;
  }
  const agent = c.req.query("agent");
  const filter = c.req.query("status") ?? "pending";
  if (filter !== "pending" && filter !== "decided" && filter !== "all") {
    return fail(400, "bad-request", "Refused. Unknown approval status.");
  }
  if (privyCheck.kind === "person") {
    const approver = deps.store.getEnvelopeMirror(agent ?? "")?.envelope.approver;
    if (!owns(privyCheck.person, approver)) {
      return fail(403, "not-your-agent", "Refused. This agent's approver key is not one of your wallets.");
    }
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
  const privyCheck = await personFrom(c.req.raw.headers, deps.privy);
  if (privyCheck.kind === "refused") return fail(privyCheck.status, privyCheck.code, privyCheck.message);
  if (privyCheck.kind === "none") {
    const refused = requireToken(c, deps);
    if (refused) return refused;
  }

  const id = c.req.param("id");
  const row = id === undefined ? null : deps.store.getApproval(id);
  if (row === null) return fail(404, "unknown-approval", "Refused. That approval is not known.");
  if (privyCheck.kind === "person") {
    const approver = deps.store.getEnvelopeMirror(row.agent)?.envelope.approver;
    if (!owns(privyCheck.person, approver)) {
      return fail(403, "not-your-agent", "Refused. This agent's approver key is not one of your wallets.");
    }
  }
  const now = deps.now();
  const status = effectiveStatus(row, now);
  if (status === "expired") return fail(409, "expired", "Refused. This approval has expired.");
  if (status !== "pending") return fail(409, "already-decided", "Refused. This approval is already decided.");

  const body = await readJsonLimited(c);
  if (body.kind === "too-large") return fail(413, "too-large", "Refused. The request body is too large.");
  if (body.kind === "malformed") return fail(400, "bad-request", "Refused. The decision is malformed.");
  const value = body.value;
  if (!isRecord(value)) return fail(400, "bad-request", "Refused. The decision is malformed.");
  const decision = value.decision;
  if (decision !== "countersign" && decision !== "decline") {
    return fail(400, "bad-request", "Refused. The decision is not countersign or decline.");
  }
  const decidedAt = value.decidedAt;
  const sig = value.sig;
  if (!Number.isSafeInteger(decidedAt) || typeof sig !== "string") {
    return fail(400, "bad-request", "Refused. The decision needs a signed decision time.");
  }
  if (Math.abs(now - (decidedAt as number)) > CLOCK_SKEW) {
    return fail(400, "bad-request", "Refused. The decision time is not the hub's clock.");
  }

  const approver = deps.store.getEnvelopeMirror(row.agent)?.envelope.approver;
  if (approver === undefined) {
    return fail(409, "no-approver", "Refused. This agent's envelope names no approver key.");
  }
  if (row.request === null) {
    return fail(400, "bad-request", "Refused. The approval has no stored request.");
  }

  const signer = await approvalDecisionSigner(
    approvalDecisionBody({
      approvalId: row.id,
      agent: row.agent,
      offerHash: row.offerHash,
      amount: row.amount,
      rail: row.rail,
      terms: row.terms,
      requestHash: approvalRequestHash(row.request),
      decision,
      decidedAt: decidedAt as number,
    }),
    sig,
  );
  if (signer === null || signer.toLowerCase() !== approver.toLowerCase()) {
    return fail(401, "bad-signature", "Refused. The decision is not signed by the envelope's approver.");
  }

  if (!deps.store.decideApproval(row.id, decision, decidedAt as number, sig)) {
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
  request: ApprovalRequest | null;
  requestSig: string | null;
  decidedAt: number | null;
  decisionSig: string | null;
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
    request: row.request,
    requestSig: row.requestSig,
    decidedAt: row.decidedAt,
    decisionSig: row.decisionSig,
  };
}

async function recover(message: string, sig: string): Promise<string | null> {
  try {
    return await recoverMessageAddress({ message, signature: sig as Hex });
  } catch {
    return null;
  }
}

/** Null when the caller may read or decide; otherwise the refusal response. */
function requireToken(c: Context, deps: BuyerPlumbingDeps): Response | null {
  const expected = deps.humanApprovalToken;
  if (expected === undefined || expected === "") {
    return fail(503, "no-approver", "Refused. No human approver is configured.");
  }
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(header);
  if (match === null || !sameToken(match[1] ?? "", expected)) {
    return fail(401, "unauthorized", "Refused. The approver token is not valid.");
  }
  return null;
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

type LimitedJson =
  | { kind: "ok"; value: unknown }
  | { kind: "too-large" }
  | { kind: "malformed" };

async function readJsonLimited(c: Context): Promise<LimitedJson> {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return { kind: "malformed" };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return { kind: "too-large" };
  try {
    return { kind: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { kind: "malformed" };
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
