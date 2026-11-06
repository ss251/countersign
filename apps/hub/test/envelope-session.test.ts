import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  canonicalJson,
  type Envelope,
  type EnvelopeSpend,
  type ErrorBody,
} from "../src/deps.ts";
import { createHub, type HubDeps } from "../src/app.ts";
import {
  PRIVY_HEADER,
  PrivySessionError,
  PrivyUnavailableError,
  type Person,
  type PrivyVerifier,
} from "../src/privy.ts";
import { Store } from "../src/store.ts";
import { BUYER, FakeRail } from "./fake-rail.ts";
import { NOW, seller, type TestHub as SupportTestHub } from "./support.ts";

const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const APPROVER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const AGENT = privateKeyToAccount(AGENT_KEY);
const OTHER = privateKeyToAccount(OTHER_KEY);
const APPROVER = privateKeyToAccount(APPROVER_KEY);
const TOKEN = "s3cret-human-token";
const BOB_WALLET = "0x9999999999999999999999999999999999999999";

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

interface TestHub extends SupportTestHub {
  setNow: (at: number) => void;
}

interface SessionBody {
  agent: string;
  envelope: Envelope;
  issued: boolean;
  token: string;
  tokenExpiresAt: number;
}

let hubs: TestHub[] = [];

afterEach(() => {
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

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function post(
  hub: TestHub,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return fetch(`${hub.url}/envelopes/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function issue(hub: TestHub): Promise<SessionBody> {
  const response = await post(hub, privyHeader("alice"), { agent: APPROVER_WALLET });
  expect(response.status).toBe(200);
  return (await response.json()) as SessionBody;
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

async function createApproval(url: string): Promise<Response> {
  return postApproval(url, await approvalRequest());
}

describe("POST /envelopes/session", () => {
  test("a caller with no session gets 401 and nothing is issued", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });

    const response = await post(hub, {}, { agent: APPROVER_WALLET });
    expect(response.status).toBe(401);
    const body = (await response.json()) as ErrorBody & { token?: string };
    expect(body.code).toBe("sign-in-required");
    expect(body.token).toBeUndefined();
    expect(hub.store.getEnvelopeMirror(APPROVER_WALLET)).toBeNull();
  });

  test("a hub without Privy refuses with sign-in-required", async () => {
    const hub = startPrivyHub({ humanApprovalToken: TOKEN });

    const response = await post(hub, privyHeader("alice"), { agent: APPROVER_WALLET });
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("sign-in-required");
  });

  test("the first call issues a 24-hour envelope and a scoped token", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });

    const response = await post(hub, privyHeader("alice"), { agent: APPROVER_WALLET });
    expect(response.status).toBe(200);
    const body = (await response.json()) as SessionBody;
    expect(body.token.startsWith("cse_")).toBe(true);
    expect(body.token).toHaveLength(68);
    expect(body.issued).toBe(true);
    expect(body.tokenExpiresAt).toBe(NOW + 86_400);
    expect(body.envelope).toEqual({
      v: 1,
      agent: APPROVER_WALLET as Address,
      cap: "1000000",
      perMerchant: "500000",
      allowlist: [],
      revoked: false,
      expiresAt: NOW + 86_400,
      askAbove: "50000",
      approver: APPROVER_WALLET as Address,
    });
  });

  test("the token opens its own agent's envelope and approvals", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    const session = await issue(hub);

    const envelope = await fetch(`${hub.url}/envelopes/${APPROVER_WALLET}`, {
      headers: bearer(session.token),
    });
    expect(envelope.status).toBe(200);
    const envelopeBody = (await envelope.json()) as { verified: boolean };
    expect(envelopeBody.verified).toBe(false);

    const approvals = await fetch(`${hub.url}/approvals?agent=${APPROVER_WALLET}`, {
      headers: bearer(session.token),
    });
    expect(approvals.status).toBe(200);
  });

  test("the token is refused for every other agent and route", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    const session = await issue(hub);
    const mirror = await signedMirror(AGENT, APPROVER_ENVELOPE, SPENT, NOW);
    expect((await putMirror(hub.url, AGENT.address, mirror)).status).toBe(200);
    const created = await createApproval(hub.url);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const headers = bearer(session.token);

    const ownEnvelope = await fetch(`${hub.url}/envelopes/${AGENT.address}`, { headers });
    expect(ownEnvelope.status).toBe(401);

    const ownApprovals = await fetch(`${hub.url}/approvals?agent=${AGENT.address}`, { headers });
    expect(ownApprovals.status).toBe(401);

    const everyApproval = await fetch(`${hub.url}/approvals`, { headers });
    expect(everyApproval.status).toBe(401);

    const decision = await fetch(`${hub.url}/approvals/${id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        decision: "countersign",
        decidedAt: NOW,
        sig: `0x${"11".repeat(65)}`,
      }),
    });
    expect(decision.status).toBe(401);
  });

  test("a wallet the person does not own is refused", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });

    const response = await post(hub, privyHeader("alice"), { agent: BOB_WALLET });
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody & { token?: string };
    expect(body.code).toBe("not-your-wallet");
    expect(body.token).toBeUndefined();
    expect(hub.store.getEnvelopeMirror(BOB_WALLET)).toBeNull();
  });

  test("an agent whose approver is someone else's is refused", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    hub.store.putEnvelopeMirror({
      agent: BOB_WALLET,
      envelope: {
        ...ENVELOPE,
        agent: BOB_WALLET as Address,
        approver: APPROVER_WALLET as Address,
      },
      spent: SPENT,
      signedAt: NOW,
      sig: "0x",
    });

    const response = await post(hub, privyHeader("bob"), { agent: BOB_WALLET });
    expect(response.status).toBe(403);
    expect(((await response.json()) as ErrorBody).code).toBe("not-your-agent");
  });

  test("a second call replaces the token and keeps the envelope", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    const first = await issue(hub);
    const second = await issue(hub);

    expect(second.issued).toBe(false);
    expect(second.envelope).toEqual(first.envelope);
    expect(second.token).not.toBe(first.token);

    const stale = await fetch(`${hub.url}/envelopes/${APPROVER_WALLET}`, {
      headers: bearer(first.token),
    });
    expect(stale.status).toBe(401);

    const fresh = await fetch(`${hub.url}/envelopes/${APPROVER_WALLET}`, {
      headers: bearer(second.token),
    });
    expect(fresh.status).toBe(200);
  });

  test("an expired token is refused", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    const session = await issue(hub);
    hub.setNow(NOW + 86_401);

    const response = await fetch(`${hub.url}/envelopes/${APPROVER_WALLET}`, {
      headers: bearer(session.token),
    });
    expect(response.status).toBe(401);
  });

  test("the store keeps only the token's hash", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    const session = await issue(hub);

    expect(hub.store.getEnvelopeToken(session.token)).toBeNull();

    const hash = createHash("sha256").update(session.token).digest("hex");
    const record = hub.store.getEnvelopeToken(hash);
    expect(record).not.toBeNull();
    expect(record?.agent).toBe(APPROVER_WALLET);
  });

  test("the operator token still opens the envelope", async () => {
    const hub = startPrivyHub({ privy: verifier, humanApprovalToken: TOKEN });
    await issue(hub);

    const response = await fetch(`${hub.url}/envelopes/${APPROVER_WALLET}`, {
      headers: bearer(TOKEN),
    });
    expect(response.status).toBe(200);
  });
});
