import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalRequestHash,
  canonicalJson,
  type Envelope,
  type EnvelopeSpend,
  type ErrorBody,
  type PaymentPayload,
  type Slip,
} from "../src/deps.ts";
import { createHub, type HubDeps } from "../src/app.ts";
import { Store } from "../src/store.ts";
import { FakeRail } from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NONCE,
  NOW,
  paymentFor,
  publishOk,
  requirementsFor,
  seller,
  startHub,
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
const BUYER_A: Address = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
const BUYER_B: Address = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const TOKEN = "s3cret-human-token";

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

const ESCROW_MESSAGE =
  "Refused. The seller's output does not match the offer. Your money returns at the deadline.";
const DIRECT_MESSAGE =
  "Refused. The seller's output does not match the offer. This rail settles before delivery, so the payment is not returned automatically; the slip records the failure.";

let hub: TestHub | undefined;
let runners: RunnerHandle[] = [];

afterEach(() => {
  for (const runner of runners) runner.close();
  runners = [];
  hub?.close();
  hub = undefined;
});

function payment(amount = "1000", network: PaymentPayload["accepted"]["network"] = "eip155:5042002"): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network,
      amount,
      asset: "0x3600000000000000000000000000000000000000",
      payTo: seller.address,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}

function slipWith(url?: string): Slip {
  const transaction = `0x${"ee".repeat(32)}`;
  return {
    body: {} as Slip["body"],
    hash: `0x${"aa".repeat(32)}`,
    sellerSig: `0x${"bb".repeat(65)}`,
    payment: payment(),
    settlement: {
      transaction,
      network: "eip155:5042002",
      ...(url !== undefined ? { url } : {}),
    },
  };
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

function startTokenHub(token: string): {
  url: string;
  store: Store;
  setNow: (at: number) => void;
  close: () => void;
} {
  const store = new Store(":memory:");
  let now = NOW;
  const rails = [new FakeRail()];
  const deps: HubDeps = {
    store,
    rails,
    now: () => now,
    publicUrl: "http://hub.test",
    humanApprovalToken: token,
  };
  const { app, websocket } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    store,
    setNow: (at) => {
      now = at;
    },
    close: () => server.stop(true),
  };
}

async function seedMirror(
  url: string,
  envelope: Envelope = APPROVER_ENVELOPE,
  account = AGENT,
  signedAt = NOW,
): Promise<void> {
  const mirror = await signedMirror(account, envelope, SPENT, signedAt);
  const response = await putMirror(url, account.address, mirror);
  if (response.status !== 200) throw new Error(`mirror seed failed with ${response.status}`);
}

async function approvalRequest(overrides: Partial<ApprovalRequest> = {}): Promise<{
  body: ApprovalRequest;
  sig: Hex;
}> {
  const body = { ...APPROVAL_REQUEST, ...overrides };
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

async function createApproval(url: string, overrides: Partial<ApprovalRequest> = {}): Promise<Response> {
  return postApproval(url, await approvalRequest(overrides));
}

async function signDecision(
  id: string,
  overrides: {
    decision?: "countersign" | "decline";
    decidedAt?: number;
    signer?: typeof AGENT;
    agent?: string;
    offerHash?: string;
    amount?: string;
    rail?: string;
    terms?: unknown;
    requestHash?: string;
  } = {},
): Promise<{ decision: "countersign" | "decline"; decidedAt: number; sig: Hex }> {
  const decision = overrides.decision ?? "countersign";
  const decidedAt = overrides.decidedAt ?? NOW;
  const body = approvalDecisionBody({
    approvalId: id,
    agent: overrides.agent ?? APPROVAL_REQUEST.agent,
    offerHash: overrides.offerHash ?? APPROVAL_REQUEST.offerHash,
    amount: overrides.amount ?? APPROVAL_REQUEST.amount,
    rail: overrides.rail ?? APPROVAL_REQUEST.rail,
    terms: overrides.terms ?? APPROVAL_REQUEST.terms,
    requestHash: overrides.requestHash ?? approvalRequestHash(APPROVAL_REQUEST),
    decision,
    decidedAt,
  });
  const sig = await (overrides.signer ?? APPROVER).signMessage({
    message: approvalDecisionMessage(body),
  });
  return { decision, decidedAt, sig };
}

function postDecision(
  url: string,
  id: string,
  signed: { decision: unknown; decidedAt: unknown; sig?: unknown },
  token?: string,
): Promise<Response> {
  return fetch(`${url}/approvals/${id}/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(signed),
  });
}

function authGet(url: string, token = TOKEN): Promise<Response> {
  return fetch(url, { headers: { authorization: `Bearer ${token}` } });
}

describe("jobs by buyer", () => {
  test("returns only that buyer's rows, newest first, with explorer links", async () => {
    const empty = new FakeRail("gateway");
    empty.declaration.explorerTx = "";
    hub = startHub({ rails: [new FakeRail(), empty] });

    const first = makeOffer({ title: "First buy" });
    const second = makeOffer({ title: "Second buy" });
    const third = makeOffer({ title: "Third buy" });
    const firstHash = await publishOk(hub, first);
    const secondHash = await publishOk(hub, second);
    const thirdHash = await publishOk(hub, third);
    const slip = slipWith("https://explorer.test/slip/1");

    hub.store.putSlip(slip.hash, `0x${"01".repeat(32)}`, slip, NOW + 10);
    hub.store.putJob({
      jobId: `0x${"01".repeat(32)}`,
      offerHash: firstHash,
      rail: "escrow",
      buyer: BUYER_A,
      amount: "1000",
      deadline: NOW + 60,
      status: "released",
      payment: payment("1000"),
      settleTx: `0x${"dd".repeat(32)}`,
      closeTx: `0x${"cc".repeat(32)}`,
      slipHash: slip.hash,
      createdAt: NOW + 10,
    });
    hub.store.putJob({
      jobId: `0x${"02".repeat(32)}`,
      offerHash: secondHash,
      rail: "escrow",
      buyer: BUYER_A.toLowerCase() as Address,
      amount: "2000",
      deadline: NOW + 60,
      status: "funded",
      payment: payment("2000"),
      settleTx: `0x${"11".repeat(32)}`,
      closeTx: `0x${"22".repeat(32)}`,
      slipHash: null,
      createdAt: NOW + 20,
    });
    hub.store.putJob({
      jobId: `0x${"03".repeat(32)}`,
      offerHash: thirdHash,
      rail: "gateway",
      buyer: BUYER_A,
      amount: "3000",
      deadline: NOW + 60,
      status: "settled",
      payment: payment("3000"),
      settleTx: `0x${"33".repeat(32)}`,
      closeTx: `0x${"44".repeat(32)}`,
      slipHash: null,
      createdAt: NOW + 30,
    });
    hub.store.putJob({
      jobId: `0x${"04".repeat(32)}`,
      offerHash: thirdHash,
      rail: "escrow",
      buyer: BUYER_B,
      amount: "4000",
      deadline: NOW + 60,
      status: "released",
      payment: payment("4000"),
      settleTx: `0x${"55".repeat(32)}`,
      closeTx: `0x${"66".repeat(32)}`,
      slipHash: null,
      createdAt: NOW + 40,
    });

    const response = await fetch(`${hub.url}/jobs?buyer=${BUYER_A.toLowerCase()}&limit=2`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobs: {
        jobId: string;
        offerHash: string;
        title: string;
        amount: string;
        rail: string;
        network: string;
        status: string;
        at: number;
        settleTx: string | null;
        closeTx: string | null;
        slipHash: string | null;
        explorer: string | null;
      }[];
    };

    expect(body.jobs.map((job) => job.jobId)).toEqual([`0x${"03".repeat(32)}`, `0x${"02".repeat(32)}`]);
    expect(body.jobs[0]?.title).toBe("Third buy");
    expect(body.jobs[0]?.rail).toBe("gateway");
    expect(body.jobs[0]?.network).toBe("eip155:5042002");
    expect(body.jobs[0]?.status).toBe("settled");
    expect(body.jobs[0]?.at).toBe(NOW + 30);
    expect(body.jobs[0]?.explorer).toBeNull();
    expect(body.jobs[1]?.explorer).toBe(`https://testnet.arcscan.app/tx/0x${"22".repeat(32)}`);
  });

  test("a stored slip's settlement url wins over the rail template", async () => {
    hub = startHub();
    const offer = makeOffer({ title: "Slipped" });
    const hash = await publishOk(hub, offer);
    const slip = slipWith("https://explorer.test/slip/2");
    hub.store.putSlip(slip.hash, `0x${"05".repeat(32)}`, slip, NOW);
    hub.store.putJob({
      jobId: `0x${"05".repeat(32)}`,
      offerHash: hash,
      rail: "escrow",
      buyer: BUYER_A,
      amount: "1000",
      deadline: NOW + 60,
      status: "released",
      payment: payment(),
      settleTx: `0x${"77".repeat(32)}`,
      closeTx: `0x${"88".repeat(32)}`,
      slipHash: slip.hash,
      createdAt: NOW,
    });

    const body = (await fetch(`${hub.url}/jobs?buyer=${BUYER_A}`).then((r) => r.json())) as {
      jobs: { explorer: string | null }[];
    };
    expect(body.jobs[0]?.explorer).toBe("https://explorer.test/slip/2");
  });

  test("a missing buyer is a 400", async () => {
    hub = startHub();
    const response = await fetch(`${hub.url}/jobs`);
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("bad-request");
  });
});

describe("envelope mirror", () => {
  test("stores a signed mirror and serves it back", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const mirror = await signedMirror(AGENT, ENVELOPE, SPENT, NOW);

      const put = await putMirror(tokenHub.url, AGENT.address.toLowerCase(), mirror);
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({ ok: true });

      const get = await authGet(`${tokenHub.url}/envelopes/${AGENT.address.toUpperCase()}`);
      expect(get.status).toBe(200);
      const body = (await get.json()) as {
        envelope: Envelope;
        spent: EnvelopeSpend;
        signedAt: number;
        sig: string;
        verified: boolean;
      };
      expect(body.envelope).toEqual(ENVELOPE);
      expect(body.spent).toEqual(SPENT);
      expect(body.signedAt).toBe(NOW);
      expect(body.sig).toBe(mirror.sig);
      expect(body.verified).toBe(true);
    } finally {
      tokenHub.close();
    }
  });

  test("reads need the approver token", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const mirror = await signedMirror(AGENT, ENVELOPE, SPENT, NOW);
      expect((await putMirror(tokenHub.url, AGENT.address, mirror)).status).toBe(200);

      expect((await fetch(`${tokenHub.url}/envelopes/${AGENT.address}`)).status).toBe(401);
      expect(
        (await fetch(`${tokenHub.url}/envelopes/${AGENT.address}`, {
          headers: { authorization: "Bearer wrong" },
        })).status,
      ).toBe(401);
      expect((await authGet(`${tokenHub.url}/envelopes/${AGENT.address}`)).status).toBe(200);

      expect((await fetch(`${tokenHub.url}/approvals?agent=${AGENT.address}`)).status).toBe(401);
      expect((await authGet(`${tokenHub.url}/approvals?agent=${AGENT.address}`)).status).toBe(200);
    } finally {
      tokenHub.close();
    }
  });

  test("a hub with no token refuses reads with 503", async () => {
    hub = startHub();
    expect((await fetch(`${hub.url}/envelopes/${AGENT.address}`)).status).toBe(503);
    expect((await fetch(`${hub.url}/approvals?agent=${AGENT.address}`)).status).toBe(503);
  });

  test("an oversized mirror is a 413", async () => {
    hub = startHub();
    const mirror = await signedMirror(AGENT, ENVELOPE, SPENT, NOW);
    const response = await fetch(`${hub.url}/envelopes/${AGENT.address}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...mirror, pad: "x".repeat(17_000) }),
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as ErrorBody).code).toBe("too-large");
  });

  test("a wrong signer is a 401", async () => {
    hub = startHub();
    const mirror = await signedMirror(OTHER, ENVELOPE, SPENT, NOW);
    const response = await putMirror(hub.url, AGENT.address, mirror);
    expect(response.status).toBe(401);
  });

  test("an envelope naming a different agent is a 401", async () => {
    hub = startHub();
    const wrong = { ...ENVELOPE, agent: OTHER.address };
    const mirror = await signedMirror(AGENT, wrong, SPENT, NOW);
    const response = await putMirror(hub.url, AGENT.address, mirror);
    expect(response.status).toBe(401);
  });

  test("a stale signedAt is a 409", async () => {
    hub = startHub();
    const mirror = await signedMirror(AGENT, ENVELOPE, SPENT, NOW - 301);
    const response = await putMirror(hub.url, AGENT.address, mirror);
    expect(response.status).toBe(409);
  });

  test("an older mirror does not overwrite a newer one", async () => {
    hub = startHub();
    const newer = await signedMirror(AGENT, ENVELOPE, SPENT, NOW);
    expect((await putMirror(hub.url, AGENT.address, newer)).status).toBe(200);

    const older = await signedMirror(AGENT, ENVELOPE, SPENT, NOW - 10);
    const response = await putMirror(hub.url, AGENT.address, older);
    expect(response.status).toBe(409);
  });

  test("an unknown agent has no mirror", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const response = await authGet(`${tokenHub.url}/envelopes/${AGENT.address}`);
      expect(response.status).toBe(404);
      const body = (await response.json()) as ErrorBody;
      expect(body.code).toBe("unknown-agent");
    } finally {
      tokenHub.close();
    }
  });
});

describe("human approvals", () => {
  test("create, list, decide with the approver's signature, and refuse a second decision", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const request = await approvalRequest();
      const created = await postApproval(tokenHub.url, request);
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect(id).toMatch(/^[0-9a-f]{32}$/);

      const pending = (await authGet(
        `${tokenHub.url}/approvals?agent=${AGENT.address.toLowerCase()}&status=pending`,
      ).then((r) => r.json())) as { approvals: { id: string; status: string }[] };
      expect(pending.approvals.map((row) => row.id)).toEqual([id]);
      expect(pending.approvals[0]?.status).toBe("pending");

      const one = await fetch(`${tokenHub.url}/approvals/${id}`);
      expect(one.status).toBe(200);
      const oneBody = (await one.json()) as {
        status: string;
        request: ApprovalRequest;
        requestSig: string | null;
      };
      expect(oneBody.status).toBe("pending");
      expect(oneBody.request).toEqual(request.body);
      expect(oneBody.requestSig).toBe(request.sig);

      const signed = await signDecision(id);
      expect((await postDecision(tokenHub.url, id, signed, "wrong")).status).toBe(401);
      expect((await postDecision(tokenHub.url, id, signed)).status).toBe(401);

      const decided = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(decided.status).toBe(200);

      const after = (await fetch(`${tokenHub.url}/approvals/${id}`).then((r) => r.json())) as {
        status: string;
        decidedAt: number | null;
        decisionSig: string | null;
      };
      expect(after.status).toBe("countersign");
      expect(after.decidedAt).toBe(NOW);
      expect(after.decisionSig).toBe(signed.sig);

      expect((await postDecision(tokenHub.url, id, signed, TOKEN)).status).toBe(409);

      const decidedList = (await authGet(
        `${tokenHub.url}/approvals?agent=${AGENT.address}&status=decided`,
      ).then((r) => r.json())) as { approvals: { id: string }[] };
      expect(decidedList.approvals.map((row) => row.id)).toEqual([id]);
    } finally {
      tokenHub.close();
    }
  });

  test("a decision with no signature is a 400", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const response = await postDecision(
        tokenHub.url,
        id,
        { decision: "countersign", decidedAt: NOW },
        TOKEN,
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).code).toBe("bad-request");
    } finally {
      tokenHub.close();
    }
  });

  test("a signature from a key that is not the approver is a 401", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const signed = await signDecision(id, { signer: OTHER });
      const response = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");
    } finally {
      tokenHub.close();
    }
  });

  test("a decision time away from the hub's clock is a 400", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const signed = await signDecision(id, { decidedAt: NOW - 301 });
      const response = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(response.status).toBe(400);
      expect(((await response.json()) as ErrorBody).code).toBe("bad-request");
    } finally {
      tokenHub.close();
    }
  });

  test("a bad request signature is a 401 and a stale request is a 409", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const body = APPROVAL_REQUEST;
      const sig = await OTHER.signMessage({ message: canonicalJson(body) });
      expect((await postApproval(tokenHub.url, { body, sig })).status).toBe(401);
      expect((await createApproval(tokenHub.url, { requestedAt: NOW - 301 })).status).toBe(409);
    } finally {
      tokenHub.close();
    }
  });

  test("an agent without a mirror cannot ask for approvals", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const response = await createApproval(tokenHub.url);
      expect(response.status).toBe(409);
      expect(((await response.json()) as ErrorBody).code).toBe("unknown-agent");
    } finally {
      tokenHub.close();
    }
  });

  test("a decision for an envelope with no approver is a 409 no-approver", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url, ENVELOPE);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const signed = await signDecision(id);
      const response = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(response.status).toBe(409);
      expect(((await response.json()) as ErrorBody).code).toBe("no-approver");
    } finally {
      tokenHub.close();
    }
  });

  test("a replayed approval request is a 409", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const request = await approvalRequest();
      expect((await postApproval(tokenHub.url, request)).status).toBe(201);
      const replay = await postApproval(tokenHub.url, request);
      expect(replay.status).toBe(409);
      expect(((await replay.json()) as ErrorBody).code).toBe("duplicate-request");
    } finally {
      tokenHub.close();
    }
  });

  test("the twenty-first pending request is a 429", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      for (let i = 0; i < 20; i++) {
        const response = await createApproval(tokenHub.url, { amount: String(5_000_000 + i) });
        expect(response.status).toBe(201);
      }
      const response = await createApproval(tokenHub.url, { amount: "5999999" });
      expect(response.status).toBe(429);
      expect(((await response.json()) as ErrorBody).code).toBe("too-many-pending");
    } finally {
      tokenHub.close();
    }
  });

  test("an oversized approval request is a 413", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const response = await fetch(`${tokenHub.url}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pad: "x".repeat(17_000) }),
      });
      expect(response.status).toBe(413);
      expect(((await response.json()) as ErrorBody).code).toBe("too-large");
    } finally {
      tokenHub.close();
    }
  });

  test("a missing or malformed nonce is a 400", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const withoutNonce: Record<string, unknown> = { ...APPROVAL_REQUEST };
      delete withoutNonce.nonce;
      const sig = await AGENT.signMessage({ message: canonicalJson(withoutNonce) });
      const missing = await fetch(`${tokenHub.url}/approvals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...withoutNonce, sig }),
      });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as ErrorBody).code).toBe("bad-request");

      const malformed = await createApproval(tokenHub.url, { nonce: "0x1234" });
      expect(malformed.status).toBe(400);
      expect(((await malformed.json()) as ErrorBody).code).toBe("bad-request");
    } finally {
      tokenHub.close();
    }
  });

  test("a decision bound to another request's hash is a 401", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const otherHash = approvalRequestHash({ ...APPROVAL_REQUEST, nonce: `0x${"bb".repeat(32)}` });
      const signed = await signDecision(id, { requestHash: otherHash });
      const response = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorBody).code).toBe("bad-signature");
    } finally {
      tokenHub.close();
    }
  });

  test("an oversized decision is a 413", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      const response = await fetch(`${tokenHub.url}/approvals/${id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          decision: "countersign",
          decidedAt: NOW,
          sig: `0x${"11".repeat(65)}`,
          pad: "x".repeat(17_000),
        }),
      });
      expect(response.status).toBe(413);
      expect(((await response.json()) as ErrorBody).code).toBe("too-large");
    } finally {
      tokenHub.close();
    }
  });

  test("no configured approver is a 503", async () => {
    hub = startHub();
    await seedMirror(hub.url);
    const created = await createApproval(hub.url);
    const { id } = (await created.json()) as { id: string };
    const signed = await signDecision(id);
    const response = await postDecision(hub.url, id, signed, TOKEN);
    expect(response.status).toBe(503);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("no-approver");
  });

  test("an approval older than fifteen minutes reads expired and cannot be decided", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      await seedMirror(tokenHub.url);
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      tokenHub.setNow(NOW + 901);

      const one = (await fetch(`${tokenHub.url}/approvals/${id}`).then((r) => r.json())) as {
        status: string;
      };
      expect(one.status).toBe("expired");

      const pending = (await authGet(
        `${tokenHub.url}/approvals?agent=${AGENT.address}&status=pending`,
      ).then((r) => r.json())) as { approvals: unknown[] };
      expect(pending.approvals).toEqual([]);

      const signed = await signDecision(id, { decidedAt: NOW + 901 });
      const response = await postDecision(tokenHub.url, id, signed, TOKEN);
      expect(response.status).toBe(409);
      const body = (await response.json()) as ErrorBody;
      expect(body.code).toBe("expired");
    } finally {
      tokenHub.close();
    }
  });
});

describe("failed delivery message", () => {
  test("an escrow rail promises the deadline refund", async () => {
    hub = startHub();
    const hash = await publishOk(hub, makeOffer());
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: 123 } }),
    });
    await runner.ready;
    runners.push(runner);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, paymentFor(entry));
    expect(response.status).toBe(502);
    expect(((await response.json()) as ErrorBody).message).toBe(ESCROW_MESSAGE);
  });

  test("a direct rail says the payment is not returned automatically", async () => {
    hub = startHub({ rails: [new FakeRail("eip3009", "eip155:1874")] });
    const hash = await publishOk(hub, makeOffer({ rails: ["eip3009"] }));
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () => ({ output: { q: 123 } }),
    });
    await runner.ready;
    runners.push(runner);

    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const payment = paymentFor(entry, NONCE);
    const response = await call(hub, hash, { q: "hello" }, payment);
    expect(response.status).toBe(502);
    expect(((await response.json()) as ErrorBody).message).toBe(DIRECT_MESSAGE);
    expect(hub.rail.releaseCalls).toHaveLength(0);
  });
});
