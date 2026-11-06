import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  offerHash,
  PAYMENT_SIGNATURE_HEADER,
  slipHash,
  slipTypedData,
  toBase64Json,
  type CallResult,
  type ErrorBody,
  type PaymentPayload,
  type Slip,
  type SlipBody,
} from "../src/deps.ts";
import { parentOf } from "../src/call.ts";
import { ASSET, BUYER, NETWORK } from "./fake-rail.ts";
import { FakeRail } from "./fake-rail.ts";
import { startRunner, type RunnerHandle } from "./runner-client.ts";
import {
  makeOffer,
  NOW,
  other,
  paymentFor,
  publish,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";

const J = job("aa");

describe("recording the parent", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub({ rails: [new FakeRail()] });
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("a paid call records the last lineage job this hub knows", async () => {
    const { parentOffer, childOffer } = await bringUp(hub, runners);
    const unknown = job("99");

    const parent = await pay(hub, parentOffer, J);
    expect(parent.slip.body.jobId).toBe(J);
    expect(hub.store.getJob(J)?.parentJobId).toBeNull();

    const nested = await pay(hub, childOffer, job("b1"), [J]);
    expect(hub.store.getJob(nested.slip.body.jobId)?.parentJobId).toBe(J);

    const bare = await pay(hub, childOffer, job("b2"));
    expect(hub.store.getJob(bare.slip.body.jobId)?.parentJobId).toBeNull();

    const offersOnly = await pay(hub, childOffer, job("b3"), [parentOffer]);
    expect(hub.store.getJob(offersOnly.slip.body.jobId)?.parentJobId).toBeNull();

    const missingJob = await pay(hub, childOffer, job("b4"), [unknown]);
    expect(hub.store.getJob(missingJob.slip.body.jobId)?.parentJobId).toBeNull();

    const skipped = await pay(hub, childOffer, job("b5"), [parentOffer, J]);
    expect(hub.store.getJob(skipped.slip.body.jobId)?.parentJobId).toBe(J);

    expect(parentOf(hub.store, [parentOffer, J])).toBe(J);
    expect(parentOf(hub.store, [J, parentOffer])).toBe(J);
    expect(parentOf(hub.store, [parentOffer])).toBeNull();
    expect(parentOf(hub.store, [unknown])).toBeNull();
    expect(parentOf(hub.store, [])).toBeNull();
  });
});

describe("GET /jobs/:jobId/children", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub({ rails: [new FakeRail()] });
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("lists the jobs claimed inside J, in order, each with its slip once released", async () => {
    const { parentOffer, childOffer } = await bringUp(hub, runners);

    hub.setNow(NOW);
    await pay(hub, parentOffer, J);

    const before = await fetch(`${hub.url}/jobs/${J}/children`);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ jobId: J, children: [] });

    hub.setNow(NOW + 1);
    const first = await pay(hub, childOffer, job("ff"), [J]);
    hub.setNow(NOW + 2);
    const second = await pay(hub, childOffer, job("10"), [J]);
    hub.setNow(NOW + 3);
    const unrelated = await pay(hub, childOffer, job("b0"));
    expect(hub.store.getJob(unrelated.slip.body.jobId)?.parentJobId).toBeNull();

    const response = await fetch(`${hub.url}/jobs/${J}/children`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ChildrenBody;
    expect(body).toEqual({
      jobId: J,
      children: [
        { jobId: job("ff"), offerHash: childOffer, status: "released", slipHash: first.slip.hash },
        { jobId: job("10"), offerHash: childOffer, status: "released", slipHash: second.slip.hash },
      ],
    });

    const upper = await fetch(`${hub.url}/jobs/${J.toUpperCase()}/children`);
    const upperBody = (await upper.json()) as ChildrenBody;
    expect(upperBody.children.map((child) => child.jobId)).toEqual([job("ff"), job("10")]);

    const unknown = await fetch(`${hub.url}/jobs/${job("99")}/children`);
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ jobId: job("99"), children: [] });
  });
});

describe("GET /trees/:root", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub({ rails: [new FakeRail()] });
  });

  afterEach(() => {
    hub.close();
  });

  test("a root with two signed children, one of which has its own child, returns all four titled nodes", async () => {
    const rootOffer = rememberOffer(hub, "Root title");
    const alphaOffer = rememberOffer(hub, "Alpha");
    const betaOffer = rememberOffer(hub, "Beta");
    const grandOffer = job("cd");

    const grand = keep(hub, await signedSlip({ jobId: job("11"), offerHash: grandOffer }));
    const alpha = keep(
      hub,
      await signedSlip({ jobId: job("12"), offerHash: alphaOffer, children: [grand.hash] }),
    );
    const beta = keep(hub, await signedSlip({ jobId: job("13"), offerHash: betaOffer }));
    const root = keep(
      hub,
      await signedSlip({ jobId: job("10"), offerHash: rootOffer, children: [alpha.hash, beta.hash] }),
    );

    const body = await tree(hub, root.hash);
    expect(body.root).toBe(root.hash);
    expect(body.missing).toEqual([]);
    expect(Object.keys(body.nodes).sort()).toEqual([root.hash, alpha.hash, beta.hash, grand.hash].sort());
    expect(body.nodes[root.hash]?.title).toBe("Root title");
    expect(body.nodes[alpha.hash]?.title).toBe("Alpha");
    expect(body.nodes[beta.hash]?.title).toBe("Beta");
    expect(body.nodes[grand.hash]?.title).toBe(`offer ${short(grandOffer)}`);
    expect(body.nodes[root.hash]?.sellerName).toBe(short(seller.address));
    expect(body.nodes[alpha.hash]?.sellerName).toBe(short(seller.address));
    expect(body.nodes[root.hash]?.observed).toEqual([]);
    expect(body.nodes[root.hash]?.slip.hash).toBe(root.hash);
  });

  test("a child hash the hub does not hold goes into missing", async () => {
    const offer = rememberOffer(hub, "Held");
    const absent = job("ee");
    const child = keep(hub, await signedSlip({ jobId: job("21"), offerHash: offer }));
    const root = keep(
      hub,
      await signedSlip({ jobId: job("20"), offerHash: offer, children: [child.hash, absent] }),
    );

    const body = await tree(hub, root.hash);
    expect(Object.keys(body.nodes).sort()).toEqual([root.hash, child.hash].sort());
    expect(body.missing).toEqual([absent]);
    expect(body.nodes[absent]).toBeUndefined();
  });

  test("a cycle, where a child names the root, visits every slip once", async () => {
    const offer = rememberOffer(hub, "Cycle");
    const rootHash = job("c1");
    const childHash = job("c2");
    const root = keep(
      hub,
      await signedSlip({ jobId: job("31"), offerHash: offer, children: [childHash], hash: rootHash }),
    );
    const child = keep(
      hub,
      await signedSlip({ jobId: job("32"), offerHash: offer, children: [rootHash], hash: childHash }),
    );

    const body = await tree(hub, root.hash);
    expect(body.root).toBe(root.hash);
    expect(Object.keys(body.nodes).sort()).toEqual([root.hash, child.hash].sort());
    expect(body.missing).toEqual([]);
    expect(body.nodes[child.hash]?.slip.body.children).toEqual([root.hash]);
  });

  test("a chain deeper than 8 stops at depth 8", async () => {
    const offer = rememberOffer(hub, "Deep");
    const slips: Slip[] = [];
    let children: Hex[] = [];
    for (let depth = 11; depth >= 0; depth -= 1) {
      const slip = keep(
        hub,
        await signedSlip({ jobId: job(depth.toString(16)), offerHash: offer, children }),
      );
      slips[depth] = slip;
      children = [slip.hash];
    }
    const root = slips[0];
    if (root === undefined) throw new Error("missing root");

    const body = await tree(hub, root.hash);
    expect(Object.keys(body.nodes)).toHaveLength(9);
    for (let depth = 0; depth <= 8; depth += 1) {
      const slip = slips[depth];
      if (slip === undefined) throw new Error(`missing depth ${depth}`);
      expect(body.nodes[slip.hash]).toBeDefined();
    }
    for (let depth = 9; depth <= 11; depth += 1) {
      const slip = slips[depth];
      if (slip === undefined) throw new Error(`missing depth ${depth}`);
      expect(body.nodes[slip.hash]).toBeUndefined();
      expect(body.missing).not.toContain(slip.hash);
    }
  });

  test("an unknown root answers 404 unknown-slip", async () => {
    const response = await fetch(`${hub.url}/trees/${job("ff")}`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorBody;
    expect(body.code).toBe("unknown-slip");
    expect(body.message).toBe("Refused. That slip is not known.");
  });

  test("an empty children list still reports the child jobs the hub recorded", async () => {
    const offer = rememberOffer(hub, "Observed");
    const root = keep(hub, await signedSlip({ jobId: job("40"), offerHash: offer, children: [] }));
    const earlier = await signedSlip({ jobId: job("41"), offerHash: offer });
    const later = await signedSlip({ jobId: job("42"), offerHash: offer });
    keep(hub, earlier);
    keep(hub, later);

    hub.store.putJob(storedJob(job("ff"), root.body.jobId, earlier.hash, 5));
    hub.store.putJob(storedJob(job("01"), root.body.jobId, later.hash, 9));
    hub.store.putJob(storedJob(job("00"), root.body.jobId, null, 1));
    hub.store.putJob(storedJob(job("02"), job("ee"), earlier.hash, 2));

    const body = await tree(hub, root.hash);
    expect(Object.keys(body.nodes)).toEqual([root.hash]);
    expect(body.nodes[root.hash]?.observed).toEqual([earlier.hash, later.hash]);
    expect(body.missing).toEqual([]);
  });
});

interface ChildrenBody {
  jobId: string;
  children: Array<{ jobId: Hex; offerHash: Hex; status: string; slipHash: Hex | null }>;
}

interface TreeNode {
  slip: Slip;
  title: string;
  sellerName: string;
  observed: Hex[];
}

interface TreeBody {
  root: string;
  nodes: Record<string, TreeNode>;
  missing: string[];
}

function job(hex: string): Hex {
  return `0x${hex.padStart(64, "0")}` as Hex;
}

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

async function bringUp(hub: TestHub, runners: RunnerHandle[]): Promise<{ parentOffer: Hex; childOffer: Hex }> {
  const parentOffer = await publishOk(hub, makeOffer({ title: "Parent offer" }));
  const response = await publish(hub, makeOffer({ title: "Child offer", seller: other.address }), other);
  if (response.status !== 201) throw new Error(`publish failed ${response.status}: ${await response.text()}`);
  const childOffer = ((await response.json()) as { offerHash: Hex }).offerHash;
  runners.push(await connect(hub, seller, parentOffer));
  runners.push(await connect(hub, other, childOffer));
  return { parentOffer, childOffer };
}

async function connect(hub: TestHub, account: typeof seller, hash: Hex): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account,
    offers: [hash],
    now: () => NOW,
    respond: async () => ({ output: { q: "hello" } }),
  });
  await runner.ready;
  return runner;
}

async function pay(hub: TestHub, hash: Hex, nonce: Hex, lineage?: Hex[]): Promise<CallResult> {
  const entry = (await requirementsFor(hub, hash)).accepts[0];
  if (entry === undefined) throw new Error("missing accepts entry");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [PAYMENT_SIGNATURE_HEADER]: toBase64Json(paymentFor(entry, nonce)),
  };
  const response = await fetch(`${hub.url}/offers/${hash}/call`, {
    method: "POST",
    headers,
    body: JSON.stringify(lineage === undefined ? { input: { q: "hello" } } : { input: { q: "hello" }, lineage }),
  });
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error(`paid call ${response.status}: ${JSON.stringify(body)}`);
  return body as CallResult;
}

function rememberOffer(hub: TestHub, title: string): Hex {
  const offer = makeOffer({ title });
  const hash = offerHash(offer);
  hub.store.putOffer(hash, offer.seller, offer, NOW);
  return hash;
}

async function signedSlip(fields: {
  jobId: Hex;
  offerHash: Hex;
  children?: Hex[];
  hash?: Hex;
}): Promise<Slip> {
  const body: SlipBody = {
    v: 1,
    rail: "escrow",
    network: NETWORK,
    offerHash: fields.offerHash,
    jobId: fields.jobId,
    buyer: BUYER,
    seller: seller.address,
    payTo: seller.address,
    asset: ASSET,
    amount: "1000",
    inputHash: job("11"),
    outputHash: job("22"),
    deliveredAt: NOW,
    children: fields.children ?? [],
  };
  return {
    body,
    hash: fields.hash ?? slipHash(body),
    sellerSig: await seller.signTypedData(slipTypedData(body)),
    payment: PAYMENT,
    settlement: { transaction: "0xbb", network: NETWORK },
  };
}

function keep(hub: TestHub, slip: Slip): Slip {
  hub.store.putSlip(slip.hash, slip.body.jobId, slip, NOW);
  return slip;
}

const PAYMENT: PaymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: "countersign",
    network: NETWORK,
    amount: "1000",
    asset: ASSET,
    payTo: seller.address,
    maxTimeoutSeconds: 60,
  },
  payload: {},
};

function storedJob(id: Hex, parentJobId: Hex, slipHash: Hex | null, createdAt: number) {
  return {
    jobId: id,
    offerHash: job("ab"),
    rail: "escrow" as const,
    buyer: BUYER,
    amount: "1000",
    deadline: NOW + 60,
    status: slipHash === null ? ("paid" as const) : ("released" as const),
    payment: PAYMENT,
    settleTx: "0xaa",
    closeTx: slipHash === null ? null : "0xbb",
    slipHash,
    createdAt,
    parentJobId,
  };
}

async function tree(hub: TestHub, root: string): Promise<TreeBody> {
  const response = await fetch(`${hub.url}/trees/${root}`);
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error(`tree ${response.status}: ${JSON.stringify(body)}`);
  return body as TreeBody;
}
