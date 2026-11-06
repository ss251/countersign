import { afterEach, describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
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
const AGENT = privateKeyToAccount(AGENT_KEY);
const OTHER = privateKeyToAccount(OTHER_KEY);
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

async function createApproval(url: string, requestedAt = NOW, signer = AGENT): Promise<Response> {
  const body = {
    agent: AGENT.address,
    offerHash: `0x${"22".repeat(32)}`,
    title: "A call that needs a human",
    amount: "5000000",
    rail: "escrow",
    terms: { deadline: NOW + 120, seller: seller.address },
    requestedAt,
  };
  const sig = await signer.signMessage({ message: canonicalJson(body) });
  return fetch(`${url}/approvals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, sig }),
  });
}

function decide(url: string, id: string, token?: string): Promise<Response> {
  return fetch(`${url}/approvals/${id}/decision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ decision: "countersign" }),
  });
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
    hub = startHub();
    const mirror = await signedMirror(AGENT, ENVELOPE, SPENT, NOW);

    const put = await putMirror(hub.url, AGENT.address.toLowerCase(), mirror);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });

    const get = await fetch(`${hub.url}/envelopes/${AGENT.address.toUpperCase()}`);
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
    hub = startHub();
    const response = await fetch(`${hub.url}/envelopes/${AGENT.address}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("unknown-agent");
  });
});

describe("human approvals", () => {
  test("create, list, decide, and refuse a second decision", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const created = await createApproval(tokenHub.url);
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect(id).toMatch(/^[0-9a-f]{32}$/);

      const pending = (await fetch(
        `${tokenHub.url}/approvals?agent=${AGENT.address.toLowerCase()}&status=pending`,
      ).then((r) => r.json())) as { approvals: { id: string; status: string }[] };
      expect(pending.approvals.map((row) => row.id)).toEqual([id]);
      expect(pending.approvals[0]?.status).toBe("pending");

      const one = await fetch(`${tokenHub.url}/approvals/${id}`);
      expect(one.status).toBe(200);
      expect(((await one.json()) as { status: string }).status).toBe("pending");

      expect((await decide(tokenHub.url, id, "wrong")).status).toBe(401);
      expect((await decide(tokenHub.url, id)).status).toBe(401);

      const decided = await decide(tokenHub.url, id, TOKEN);
      expect(decided.status).toBe(200);

      const after = (await fetch(`${tokenHub.url}/approvals/${id}`).then((r) => r.json())) as {
        status: string;
        decidedAt: number | null;
      };
      expect(after.status).toBe("countersign");
      expect(after.decidedAt).toBe(NOW);

      expect((await decide(tokenHub.url, id, TOKEN)).status).toBe(409);

      const decidedList = (await fetch(
        `${tokenHub.url}/approvals?agent=${AGENT.address}&status=decided`,
      ).then((r) => r.json())) as { approvals: { id: string }[] };
      expect(decidedList.approvals.map((row) => row.id)).toEqual([id]);
    } finally {
      tokenHub.close();
    }
  });

  test("a bad signature is a 401 and a stale request is a 409", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      expect((await createApproval(tokenHub.url, NOW, OTHER)).status).toBe(401);
      expect((await createApproval(tokenHub.url, NOW - 301)).status).toBe(409);
    } finally {
      tokenHub.close();
    }
  });

  test("no configured approver is a 503", async () => {
    hub = startHub();
    const created = await createApproval(hub.url);
    const { id } = (await created.json()) as { id: string };
    const response = await decide(hub.url, id, TOKEN);
    expect(response.status).toBe(503);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("no-approver");
  });

  test("an approval older than fifteen minutes reads expired and cannot be decided", async () => {
    const tokenHub = startTokenHub(TOKEN);
    try {
      const created = await createApproval(tokenHub.url);
      const { id } = (await created.json()) as { id: string };
      tokenHub.setNow(NOW + 901);

      const one = (await fetch(`${tokenHub.url}/approvals/${id}`).then((r) => r.json())) as {
        status: string;
      };
      expect(one.status).toBe("expired");

      const pending = (await fetch(
        `${tokenHub.url}/approvals?agent=${AGENT.address}&status=pending`,
      ).then((r) => r.json())) as { approvals: unknown[] };
      expect(pending.approvals).toEqual([]);

      const response = await decide(tokenHub.url, id, TOKEN);
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
