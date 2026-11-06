import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  canonicalJson,
  envelopeRevokeMessage,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  toBase64Json,
  type Envelope,
  type EnvelopeSpend,
  type ErrorBody,
  type PaymentPayload,
} from "../src/deps.ts";
import { createHub, type HubDeps } from "../src/app.ts";
import {
  PRIVY_HEADER,
  PrivySessionError,
  type Person,
  type PrivyVerifier,
} from "../src/privy.ts";
import { Store } from "../src/store.ts";
import { FakeRail } from "./fake-rail.ts";
import {
  makeOffer,
  NOW,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  wsUrl,
  type TestHub,
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

const verifier: PrivyVerifier = {
  async verify(token: string): Promise<Person> {
    if (token === "alice") return { userId: "did:privy:alice", wallets: [APPROVER.address.toLowerCase()] };
    if (token === "bob") return { userId: "did:privy:bob", wallets: [BOB_WALLET] };
    throw new PrivySessionError("nope");
  },
};

let hubs: TestHub[] = [];
let runners: RunnerHandle[] = [];

afterEach(() => {
  for (const runner of runners) runner.close();
  runners = [];
  for (const hub of hubs) hub.close();
  hubs = [];
});

function start(options: { token?: string; privy?: PrivyVerifier; rails?: FakeRail[] } = {}): TestHub {
  const store = new Store(":memory:");
  let now = NOW;
  const fallback = new FakeRail();
  const rails = options.rails ?? [fallback];
  const deps: HubDeps = {
    store,
    rails,
    now: () => now,
    publicUrl: "http://hub.test",
  };
  if (options.token !== undefined) deps.humanApprovalToken = options.token;
  if (options.privy !== undefined) deps.privy = options.privy;
  const { app, websocket, runners: link } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  const hub: TestHub = {
    url: `http://127.0.0.1:${server.port}`,
    store,
    rail: rails[0] ?? fallback,
    rails,
    runners: link,
    deps: { ...deps, runners: link },
    setNow: (at) => {
      now = at;
    },
    close: () => {
      link.stop();
      server.stop(true);
    },
  };
  hubs.push(hub);
  return hub;
}

function startTokenHub(token: string): TestHub {
  return start({ token });
}

function startPrivyHub(privy: PrivyVerifier): TestHub {
  return start({ privy });
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

async function seedMirror(
  hub: TestHub,
  envelope: Envelope = APPROVER_ENVELOPE,
  account = AGENT,
  signedAt = NOW,
): Promise<void> {
  const mirror = await signedMirror(account, envelope, SPENT, signedAt);
  const response = await fetch(`${hub.url}/envelopes/${account.address}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mirror),
  });
  if (response.status !== 200) throw new Error(`mirror seed failed with ${response.status}`);
}

async function signRevoke(agent: string, revokedAt: number, signer = APPROVER): Promise<Hex> {
  return signer.signMessage({ message: envelopeRevokeMessage(agent, revokedAt) });
}

function postRevoke(
  hub: TestHub,
  agent: string,
  body: unknown,
  options: { token?: string; privy?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.privy !== undefined) headers[PRIVY_HEADER] = options.privy;
  return fetch(`${hub.url}/envelopes/${agent}/revoke`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

interface RevokeBody {
  agent: string;
  revoked: boolean;
  revokedAt: number;
}

async function revokeOk(
  hub: TestHub,
  agent: string,
  revokedAt = NOW,
  token = TOKEN,
): Promise<RevokeBody> {
  const sig = await signRevoke(agent, revokedAt);
  const response = await postRevoke(hub, agent, { revokedAt, sig }, { token });
  expect(response.status).toBe(200);
  return (await response.json()) as RevokeBody;
}

function callWith(
  hub: TestHub,
  hash: Hex,
  options: { agent?: string; payment?: PaymentPayload } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.payment) headers[PAYMENT_SIGNATURE_HEADER] = toBase64Json(options.payment);
  if (options.agent !== undefined) headers["X-Countersign-Agent"] = options.agent;
  return fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify({ input: { q: "hello" } }),
  });
}

async function connect(hub: TestHub, hash: Hex): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond: async () => ({ output: { q: "hello" } }),
  });
  await runner.ready;
  return runner;
}

function railPaying(agent: string): FakeRail {
  const rail = new FakeRail();
  rail.verify = async (payment, requirements) => {
    rail.verifyCalls.push({ payment, requirements });
    return { isValid: true, payer: agent };
  };
  return rail;
}

describe("the revoke", () => {
  test("the approver revokes, and the envelope reads the revocation back", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub);

    const before = (await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json())) as { revocation: unknown };
    expect(before.revocation).toBeNull();

    const sig = await signRevoke(AGENT.address, NOW);
    const response = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig }, { token: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      agent: AGENT.address.toLowerCase(),
      revoked: true,
      revokedAt: NOW,
    });

    const after = (await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json())) as { revocation: unknown };
    expect(after.revocation).toEqual({ revokedAt: NOW });
  });

  test("the first revoke is kept when a later revoke arrives", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub);

    expect(await revokeOk(hub, AGENT.address, NOW)).toEqual({
      agent: AGENT.address.toLowerCase(),
      revoked: true,
      revokedAt: NOW,
    });
    expect(await revokeOk(hub, AGENT.address, NOW + 10)).toEqual({
      agent: AGENT.address.toLowerCase(),
      revoked: true,
      revokedAt: NOW,
    });

    const after = (await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json())) as { revocation: unknown };
    expect(after.revocation).toEqual({ revokedAt: NOW });
  });
});

describe("enforcement", () => {
  test("a revoked agent is refused before any 402, with a runner online", async () => {
    const hub = startTokenHub(TOKEN);
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash));
    expect(hub.runners.isOnline(hash)).toBe(true);

    await seedMirror(hub);
    await revokeOk(hub, AGENT.address);

    const response = await callWith(hub, hash, { agent: AGENT.address });
    expect(response.status).toBe(403);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeNull();
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("envelope-revoked");
    expect(body.message).toBe(
      "Refused. This agent's envelope was revoked by its approver. Nothing was charged.",
    );
  });

  test("a paid call from the revoked agent is refused before settle", async () => {
    const rail = railPaying(AGENT.address);
    const hub = start({ token: TOKEN, rails: [rail] });
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash));

    await seedMirror(hub);
    await revokeOk(hub, AGENT.address);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const before = rail.settleCalls.length;

    const response = await callWith(hub, hash, { payment: paymentFor(entry) });
    expect(response.status).toBe(403);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("envelope-revoked");
    expect(body.message).toBe(
      "Refused. This agent's envelope was revoked by its approver. Nothing was charged.",
    );
    expect(rail.settleCalls).toHaveLength(before);
  });

  test("another agent's call still answers 402", async () => {
    const hub = startTokenHub(TOKEN);
    const hash = await publishOk(hub, makeOffer());
    runners.push(await connect(hub, hash));

    await seedMirror(hub);
    await revokeOk(hub, AGENT.address);

    const response = await callWith(hub, hash, { agent: OTHER.address });
    expect(response.status).toBe(402);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).not.toBeNull();
  });
});

describe("refusals", () => {
  test("a revoke signed by another key is a 401", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub);

    const sig = await signRevoke(AGENT.address, NOW, OTHER);
    const response = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig }, { token: TOKEN });
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");
  });

  test("an unknown agent is a 404", async () => {
    const hub = startTokenHub(TOKEN);

    const sig = await signRevoke(OTHER.address, NOW);
    const response = await postRevoke(hub, OTHER.address, { revokedAt: NOW, sig }, { token: TOKEN });
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).code).toBe("no-envelope");
  });

  test("an envelope with no approver is a 409", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub, ENVELOPE);

    const sig = await signRevoke(AGENT.address, NOW);
    const response = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig }, { token: TOKEN });
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).code).toBe("no-approver");
  });

  test("a revokedAt 600 seconds off is a 400 bad-time", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub);

    const revokedAt = NOW - 600;
    const sig = await signRevoke(AGENT.address, revokedAt);
    const response = await postRevoke(hub, AGENT.address, { revokedAt, sig }, { token: TOKEN });
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorBody).code).toBe("bad-time");
  });

  test("without the operator token the revoke is refused like a decision", async () => {
    const hub = startTokenHub(TOKEN);
    await seedMirror(hub);

    const sig = await signRevoke(AGENT.address, NOW);
    const response = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig });
    expect(response.status).toBe(401);
    expect(((await response.json()) as ErrorBody).code).toBe("unauthorized");

    const open = start();
    await seedMirror(open);
    const noToken = await postRevoke(open, AGENT.address, { revokedAt: NOW, sig });
    expect(noToken.status).toBe(503);
    expect(((await noToken.json()) as ErrorBody).code).toBe("no-approver");
  });
});

describe("the person's revoke", () => {
  test("a person who owns the approver revokes without the operator token; another is refused", async () => {
    const hub = startPrivyHub(verifier);
    await seedMirror(hub);

    const sig = await signRevoke(AGENT.address, NOW);
    const bob = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig }, { privy: "bob" });
    expect(bob.status).toBe(403);
    expect(((await bob.json()) as ErrorBody).code).toBe("not-your-agent");

    const alice = await postRevoke(hub, AGENT.address, { revokedAt: NOW, sig }, { privy: "alice" });
    expect(alice.status).toBe(200);
    expect(await alice.json()).toEqual({
      agent: AGENT.address.toLowerCase(),
      revoked: true,
      revokedAt: NOW,
    });
  });
});
