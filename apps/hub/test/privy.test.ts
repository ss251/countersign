import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  acceptTypedData,
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalRequestHash,
  canonicalJson,
  toBase64Json,
  type Envelope,
  type EnvelopeSpend,
  type ErrorBody,
  type PaymentPayload,
} from "../src/deps.ts";
import { createHub, type HubDeps } from "../src/app.ts";
import {
  createPrivyVerifier,
  personFrom,
  PRIVY_HEADER,
  PrivySessionError,
  PrivyUnavailableError,
  type Person,
  type PrivyClientLike,
  type PrivyVerifier,
} from "../src/privy.ts";
import { Store } from "../src/store.ts";
import { BUYER, FakeRail } from "./fake-rail.ts";
import {
  makeOffer,
  NONCE,
  NOW,
  other,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  wsUrl,
  type TestHub as SupportTestHub,
} from "./support.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";

const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const APPROVER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const AGENT = privateKeyToAccount(AGENT_KEY);
const OTHER = privateKeyToAccount(OTHER_KEY);
const APPROVER = privateKeyToAccount(APPROVER_KEY);
const TOKEN = "s3cret-human-token";
const BOB_WALLET = "0x9999999999999999999999999999999999999999";
const CHAIN = 5042002;
const ESCROW = "0x4444444444444444444444444444444444444444";
const SLIP: Hex = `0x${"cd".repeat(32)}`;
const ACCEPT_TX: Hex = `0x${"e1".repeat(32)}`;

const SPENT: EnvelopeSpend = { total: "0", bySeller: {} };
const ENVELOPE: Envelope = {
  v: 1,
  agent: AGENT.address,
  cap: "5000000",
  perMerchant: "1000000",
  allowlist: [],
  revoked: false,
  askAbove: "100000",
};
const APPROVER_ENVELOPE: Envelope = { ...ENVELOPE, approver: APPROVER.address };

const APPROVAL_REQUEST = {
  agent: AGENT.address,
  offerHash: `0x${"22".repeat(32)}`,
  title: "A call that needs a human",
  amount: "5000000",
  rail: "escrow",
  terms: { deadline: NOW + 120, seller: seller.address },
  requestedAt: NOW,
  nonce: `0x${"aa".repeat(32)}` as Hex,
};
type ApprovalRequest = typeof APPROVAL_REQUEST;

const APPROVER_WALLET = APPROVER.address.toLowerCase();
const ALICE_WALLETS = [APPROVER_WALLET, BUYER.toLowerCase()];

const verifier: PrivyVerifier = {
  async verify(token: string): Promise<Person> {
    if (token === "alice") return { userId: "did:privy:alice", wallets: ALICE_WALLETS };
    if (token === "bob") return { userId: "did:privy:bob", wallets: [BOB_WALLET] };
    if (token === "down") throw new PrivyUnavailableError("down");
    throw new PrivySessionError("nope");
  },
};

class ReviewRail extends FakeRail {
  readonly acceptCalls: Array<{ jobId: Hex; buyerSig: Hex }> = [];

  constructor() {
    super("escrow");
    const escrow = this.escrow;
    if (!escrow) throw new Error("the test rail has no escrow");
    escrow.accept = async (jobId, buyerSig) => {
      this.acceptCalls.push({ jobId, buyerSig });
      return { success: true, transaction: ACCEPT_TX, network: this.declaration.network };
    };
  }
}

interface TestHub extends SupportTestHub {
  setNow: (at: number) => void;
}

let hubs: TestHub[] = [];
let runners: RunnerHandle[] = [];

afterEach(() => {
  for (const runner of runners) runner.close();
  runners = [];
  for (const hub of hubs) hub.close();
  hubs = [];
});

function startPrivyHub(
  options: { privy?: PrivyVerifier; humanApprovalToken?: string; rails?: FakeRail[] } = {},
): TestHub {
  const store = new Store(":memory:");
  let now = NOW;
  const rails = options.rails ?? [new FakeRail()];
  const deps: HubDeps = {
    store,
    rails,
    now: () => now,
    publicUrl: "http://hub.test",
  };
  if (options.privy !== undefined) deps.privy = options.privy;
  if (options.humanApprovalToken !== undefined) deps.humanApprovalToken = options.humanApprovalToken;
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  const hub: TestHub = {
    url: `http://127.0.0.1:${server.port}`,
    store,
    rail: rails[0] ?? new FakeRail(),
    rails,
    runners,
    deps: { ...deps, runners },
    setNow: (at) => {
      now = at;
    },
    close: () => {
      runners.stop();
      server.stop(true);
    },
  };
  hubs.push(hub);
  return hub;
}

function privyHeader(token: string): Record<string, string> {
  return { [PRIVY_HEADER]: token };
}

function payment(amount = "1000"): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network: "eip155:5042002",
      amount,
      asset: "0x3600000000000000000000000000000000000000",
      payTo: seller.address,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}

function seedJob(hub: TestHub, overrides: { buyer?: string; status?: "funded" | "delivered" } = {}): Hex {
  const jobId = `0x${"77".repeat(32)}` as Hex;
  hub.store.putJob({
    jobId,
    offerHash: `0x${"22".repeat(32)}` as Hex,
    rail: "escrow",
    buyer: overrides.buyer ?? BUYER,
    amount: "1000",
    deadline: NOW + 60,
    status: overrides.status ?? "delivered",
    payment: payment(),
    settleTx: null,
    closeTx: null,
    slipHash: SLIP,
    createdAt: NOW,
    reviewWindow: 300,
    deliveredAt: NOW,
    endsAt: NOW + 300,
  });
  return jobId;
}

async function signedMirror(
  account: typeof AGENT,
  envelope: Envelope,
  spent: EnvelopeSpend,
  signedAt: number,
): Promise<{ envelope: Envelope; spent: EnvelopeSpend; signedAt: number; sig: Hex }> {
  const sig = await account.signMessage({ message: canonicalJson({ envelope, spent, signedAt }) });
  return { envelope, spent, signedAt, sig };
}

function putMirror(url: string, agent: string, body: unknown): Promise<Response> {
  return fetch(`${url}/envelopes/${agent}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedMirror(url: string, envelope: Envelope = APPROVER_ENVELOPE): Promise<void> {
  const mirror = await signedMirror(AGENT, envelope, SPENT, NOW);
  const response = await putMirror(url, AGENT.address, mirror);
  if (response.status !== 200) throw new Error(`mirror seed failed with ${response.status}`);
}

async function approvalRequest(): Promise<{ body: ApprovalRequest; sig: Hex }> {
  const body = { ...APPROVAL_REQUEST };
  const sig = await AGENT.signMessage({ message: canonicalJson(body) });
  return { body, sig };
}

function postApproval(url: string, request: { body: ApprovalRequest; sig: Hex }): Promise<Response> {
  return fetch(`${url}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request.body, sig: request.sig }),
  });
}

async function signDecision(
  id: string,
  overrides: { signer?: typeof AGENT } = {},
): Promise<{ decision: "countersign"; decidedAt: number; sig: Hex }> {
  const body = approvalDecisionBody({
    approvalId: id,
    agent: APPROVAL_REQUEST.agent,
    offerHash: APPROVAL_REQUEST.offerHash,
    amount: APPROVAL_REQUEST.amount,
    rail: APPROVAL_REQUEST.rail,
    terms: APPROVAL_REQUEST.terms,
    requestHash: approvalRequestHash(APPROVAL_REQUEST),
    decision: "countersign",
    decidedAt: NOW,
  });
  const sig = await (overrides.signer ?? APPROVER).signMessage({
    message: approvalDecisionMessage(body),
  });
  return { decision: "countersign", decidedAt: NOW, sig };
}

function postDecision(
  url: string,
  id: string,
  signed: { decision: unknown; decidedAt: unknown; sig?: unknown },
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${url}/approvals/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(signed),
  });
}

function callWith(
  hub: TestHub,
  hash: Hex,
  input: unknown,
  options: { payment?: PaymentPayload; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.payment) headers["PAYMENT-SIGNATURE"] = toBase64Json(options.payment);
  if (options.token) headers[PRIVY_HEADER] = options.token;
  return fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input }),
  });
}

describe("the routes without Privy", () => {
  test("a hub without privy ignores the Privy header", async () => {
    const hub = startPrivyHub();

    const plain = await fetch(`${hub.url}/envelopes/${AGENT.address}`);
    const headered = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: privyHeader("alice"),
    });
    expect(headered.status).toBe(plain.status);
    expect(await headered.json()).toEqual(await plain.json());

    const hash = await publishOk(hub, makeOffer());
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: "hello" } }),
    });
    await runner.ready;
    runners.push(runner);

    const plainCall = await callWith(hub, hash, { q: "hello" });
    const headeredCall = await callWith(hub, hash, { q: "hello" }, { token: "alice" });
    expect(plainCall.status).toBe(402);
    expect(headeredCall.status).toBe(plainCall.status);
    expect(await headeredCall.json()).toEqual(await plainCall.json());
  });
});

describe("a bad or unavailable session", () => {
  test("a bad token is a 401 bad-session on all six routes", async () => {
    const hub = startPrivyHub({ privy: verifier });
    const hash = await publishOk(hub, makeOffer());
    const jobId = seedJob(hub);
    const headers = { "content-type": "application/json", ...privyHeader("nope") };

    const envelope = await fetch(`${hub.url}/envelopes/${AGENT.address}`, { headers });
    expect(envelope.status).toBe(401);
    expect(((await envelope.json()) as ErrorBody).code).toBe("bad-session");

    const approvals = await fetch(`${hub.url}/approvals?agent=${AGENT.address}`, { headers });
    expect(approvals.status).toBe(401);
    expect(((await approvals.json()) as ErrorBody).code).toBe("bad-session");

    const decision = await fetch(`${hub.url}/approvals/x/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "countersign", decidedAt: NOW, sig: `0x${"11".repeat(65)}` }),
    });
    expect(decision.status).toBe(401);
    expect(((await decision.json()) as ErrorBody).code).toBe("bad-session");

    const call = await callWith(hub, hash, { q: "hello" }, { token: "nope" });
    expect(call.status).toBe(401);
    expect(((await call.json()) as ErrorBody).code).toBe("bad-session");

    const accept = await fetch(`${hub.url}/jobs/${jobId}/accept`, { method: "POST", headers });
    expect(accept.status).toBe(401);
    expect(((await accept.json()) as ErrorBody).code).toBe("bad-session");

    const dispute = await fetch(`${hub.url}/jobs/${jobId}/dispute`, { method: "POST", headers });
    expect(dispute.status).toBe(401);
    expect(((await dispute.json()) as ErrorBody).code).toBe("bad-session");
  });

  test("Privy down is a 503 session-unavailable on the call and the envelope read", async () => {
    const hub = startPrivyHub({ privy: verifier });
    const hash = await publishOk(hub, makeOffer());

    const call = await callWith(hub, hash, { q: "hello" }, { token: "down" });
    expect(call.status).toBe(503);
    expect(((await call.json()) as ErrorBody).code).toBe("session-unavailable");

    const envelope = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: privyHeader("down"),
    });
    expect(envelope.status).toBe(503);
    expect(((await envelope.json()) as ErrorBody).code).toBe("session-unavailable");
  });
});

describe("approval reads and decisions", () => {
  test("alice reads the envelope and approvals with no operator token; bob is refused", async () => {
    const hub = startPrivyHub({ privy: verifier });
    await seedMirror(hub.url);

    const envelope = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: privyHeader("alice"),
    });
    expect(envelope.status).toBe(200);

    const approvals = await fetch(`${hub.url}/approvals?agent=${AGENT.address}`, {
      headers: privyHeader("alice"),
    });
    expect(approvals.status).toBe(200);

    const bobEnvelope = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: privyHeader("bob"),
    });
    expect(bobEnvelope.status).toBe(403);
    expect(((await bobEnvelope.json()) as ErrorBody).code).toBe("not-your-agent");

    const bobApprovals = await fetch(`${hub.url}/approvals?agent=${AGENT.address}`, {
      headers: privyHeader("bob"),
    });
    expect(bobApprovals.status).toBe(403);
    expect(((await bobApprovals.json()) as ErrorBody).code).toBe("not-your-agent");
  });

  test("alice decides with a correct signature; a wrong signature still fails; bob is refused", async () => {
    const hub = startPrivyHub({ privy: verifier });
    await seedMirror(hub.url);
    const created = await postApproval(hub.url, await approvalRequest());
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const wrong = await signDecision(id, { signer: OTHER });
    const refused = await postDecision(hub.url, id, wrong, privyHeader("alice"));
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as ErrorBody).code).toBe("bad-signature");

    const bob = await postDecision(hub.url, id, await signDecision(id), privyHeader("bob"));
    expect(bob.status).toBe(403);
    expect(((await bob.json()) as ErrorBody).code).toBe("not-your-agent");

    const accepted = await postDecision(hub.url, id, await signDecision(id), privyHeader("alice"));
    expect(accepted.status).toBe(200);
    expect(hub.store.getApproval(id)?.status).toBe("countersign");
  });

  test("the operator token path is unchanged", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    await seedMirror(hub.url);
    const created = await postApproval(hub.url, await approvalRequest());
    const { id } = (await created.json()) as { id: string };

    const anonymous = await fetch(`${hub.url}/envelopes/${AGENT.address}`);
    expect(anonymous.status).toBe(401);
    expect(((await anonymous.json()) as ErrorBody).code).toBe("unauthorized");

    const read = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(read.status).toBe(200);

    const noBearer = await postDecision(hub.url, id, await signDecision(id));
    expect(noBearer.status).toBe(401);

    const decided = await postDecision(hub.url, id, await signDecision(id), {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(decided.status).toBe(200);
  });
});

describe("the paid call", () => {
  test("alice pays from her buyer wallet; bob cannot; a call with no token is unchanged", async () => {
    const hub = startPrivyHub({ privy: verifier });
    const rail = hub.rail;
    const hash = await publishOk(hub, makeOffer());
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: "hello" } }),
    });
    await runner.ready;
    runners.push(runner);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");

    const alice = await callWith(hub, hash, { q: "hello" }, {
      payment: paymentFor(entry, NONCE),
      token: "alice",
    });
    expect(alice.status).toBe(200);
    expect(rail.settleCalls).toHaveLength(1);

    const bob = await callWith(hub, hash, { q: "hello" }, {
      payment: paymentFor(entry, `0x${"22".repeat(32)}` as Hex),
      token: "bob",
    });
    expect(bob.status).toBe(403);
    expect(((await bob.json()) as ErrorBody).code).toBe("not-your-wallet");
    expect(rail.settleCalls).toHaveLength(1);

    const anonymous = await callWith(hub, hash, { q: "hello" }, {
      payment: paymentFor(entry, `0x${"33".repeat(32)}` as Hex),
    });
    expect(anonymous.status).toBe(200);
    expect(rail.settleCalls).toHaveLength(2);
  });
});

describe("buyer review", () => {
  test("alice gets past the Privy check; a bad signature is the existing 401", async () => {
    const hub = startPrivyHub({ privy: verifier, rails: [new ReviewRail()] });
    const jobId = seedJob(hub);

    const sig = await other.signTypedData(acceptTypedData(CHAIN, ESCROW, jobId, SLIP));
    const response = await fetch(`${hub.url}/jobs/${jobId}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", ...privyHeader("alice") },
      body: JSON.stringify({ sig }),
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");
  });

  test("bob is refused as not the job's buyer", async () => {
    const hub = startPrivyHub({ privy: verifier, rails: [new ReviewRail()] });
    const jobId = seedJob(hub);

    const response = await fetch(`${hub.url}/jobs/${jobId}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", ...privyHeader("bob") },
      body: JSON.stringify({ sig: `0x${"11".repeat(65)}` }),
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).code).toBe("not-your-job");
  });
});

describe("cors", () => {
  test("the preflight allows the Privy header", async () => {
    const hub = startPrivyHub({ privy: verifier });
    const response = await fetch(`${hub.url}/approvals/x/decision`, {
      method: "OPTIONS",
      headers: {
        origin: "https://web.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, x-privy-token",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "x-privy-token",
    );
  });
});

interface FakeClientLog {
  keys: number;
  verifies: Array<{ token: string; key: string }>;
  users: string[];
}

function fakeClient(
  config: {
    key?: string;
    claims?: { appId: string; userId: string };
    user?: { linkedAccounts: Array<{ type: string; address?: string; chainType?: string }> };
    keyFails?: boolean;
    verifyFails?: boolean;
    userFails?: boolean;
  } = {},
): PrivyClientLike & { calls: FakeClientLog } {
  const calls: FakeClientLog = { keys: 0, verifies: [], users: [] };
  return {
    calls,
    async getVerificationKey() {
      calls.keys += 1;
      if (config.keyFails) throw new Error("key down");
      return config.key ?? "key-1";
    },
    async verifyAuthToken(token, key) {
      calls.verifies.push({ token, key });
      if (config.verifyFails) throw new Error("bad jwt");
      return config.claims ?? { appId: "app", userId: "did:privy:alice" };
    },
    async getUserById(userId) {
      calls.users.push(userId);
      if (config.userFails) throw new Error("api down");
      return (
        config.user ?? {
          linkedAccounts: [
            { type: "wallet", chainType: "ethereum", address: "0xAbCdEf0000000000000000000000000000000001" },
          ],
        }
      );
    },
  };
}

describe("the verifier itself", () => {
  test("only ethereum wallets with an address are kept, lowercased", async () => {
    const client = fakeClient({
      user: {
        linkedAccounts: [
          { type: "wallet", chainType: "ethereum", address: "0xAbCdEf0000000000000000000000000000000001" },
          { type: "wallet", chainType: "solana", address: "So11111111111111111111111111111111111111112" },
          { type: "email", chainType: "ethereum", address: "0xAbCdEf0000000000000000000000000000000002" },
          { type: "wallet", chainType: "ethereum" },
        ],
      },
    });
    const verifier = createPrivyVerifier("app", "secret", { client });

    expect(await verifier.verify("token")).toEqual({
      userId: "did:privy:alice",
      wallets: ["0xabcdef0000000000000000000000000000000001"],
    });
  });

  test("a claims appId from another app is a session error", async () => {
    const verifier = createPrivyVerifier("app", "secret", {
      client: fakeClient({ claims: { appId: "other", userId: "did:privy:alice" } }),
    });
    await expect(verifier.verify("token")).rejects.toBeInstanceOf(PrivySessionError);
  });

  test("verifyAuthToken throwing is a session error", async () => {
    const verifier = createPrivyVerifier("app", "secret", {
      client: fakeClient({ verifyFails: true }),
    });
    await expect(verifier.verify("token")).rejects.toBeInstanceOf(PrivySessionError);
  });

  test("getUserById throwing is an unavailable error", async () => {
    const verifier = createPrivyVerifier("app", "secret", {
      client: fakeClient({ userFails: true }),
    });
    await expect(verifier.verify("token")).rejects.toBeInstanceOf(PrivyUnavailableError);
  });

  test("getVerificationKey throwing is 503 session-unavailable, not 401", async () => {
    const verifier = createPrivyVerifier("app", "secret", {
      client: fakeClient({ keyFails: true }),
    });
    await expect(verifier.verify("token")).rejects.toBeInstanceOf(PrivyUnavailableError);

    const check = await personFrom(new Headers({ [PRIVY_HEADER]: "token" }), verifier);
    expect(check).toEqual({
      kind: "refused",
      status: 503,
      code: "session-unavailable",
      message: "Refused. Sign-in cannot be checked right now. Nothing was charged.",
    });
  });

  test("verifyAuthToken receives the key getVerificationKey returned", async () => {
    const client = fakeClient({ key: "the-key" });
    const verifier = createPrivyVerifier("app", "secret", { client });

    await verifier.verify("token");
    expect(client.calls.verifies).toEqual([{ token: "token", key: "the-key" }]);
  });

  test("two verifies inside the cache window read the user once", async () => {
    const client = fakeClient();
    const verifier = createPrivyVerifier("app", "secret", {
      client,
      cacheMs: 60_000,
      now: () => 1_000,
    });

    await verifier.verify("one");
    await verifier.verify("two");
    expect(client.calls.verifies).toHaveLength(2);
    expect(client.calls.users).toHaveLength(1);
  });
});
