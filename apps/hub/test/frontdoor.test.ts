import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { createHub, type HubDeps } from "../src/app.ts";
import {
  slipHash,
  ZERO_HASH,
  type Offer,
  type PaymentPayload,
  type Slip,
  type SlipBody,
} from "../src/deps.ts";
import type {
  SearchResponse,
  SellersResponse,
  SettlementsResponse,
} from "../src/frontdoor.ts";
import { erc8004IdentityLookup, type IdentityClient, type IdentityLookup } from "../src/identity.ts";
import { runJanitor } from "../src/janitor.ts";
import { RunnerLink } from "../src/runners.ts";
import { Store, type JobRecord, type JobStatus } from "../src/store.ts";
import {
  ASSET,
  BUYER,
  CHAIN_ID,
  ESCROW,
  FakeRail,
  NETWORK,
} from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NONCE,
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
import { startRunner, type RunnerHandle } from "./runner-client.ts";

const REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const RELEASE_TX = `0x${"aa".repeat(32)}`;
const REFUND_TX = `0x${"bb".repeat(32)}`;

describe("offer search", () => {
  let hub: TestHub;

  beforeEach(() => {
    hub = startHub();
  });

  afterEach(() => {
    hub.close();
  });

  test("search is a route of its own and ranks a title match above a summary match", async () => {
    const titled = makeOffer({
      title: "Arc price oracle",
      summary: "Reads a price.",
      price: "3000",
    });
    const summarised = makeOffer({
      title: "Weather lookup",
      summary: "An arc of weather data.",
      price: "1000",
    });
    const unrelated = makeOffer({ title: "Ping", summary: "Nothing here." });
    const titledHash = await publishOk(hub, titled);
    const summarisedHash = await publishOk(hub, summarised);
    await publishOk(hub, unrelated);

    const body = await search(hub, { q: "arc" });
    expect(body.query).toBe("arc");
    expect(body.results.map((hit) => hit.offerHash)).toEqual([titledHash, summarisedHash]);
    expect(body.results[0]?.score).toBe(3);
    expect(body.results[1]?.score).toBe(1);
  });

  test("why names each matched token once", async () => {
    const offer = makeOffer({
      title: "Arc the question",
      summary: "Returns the question.",
      upstream: { url: "https://example.test/arc", licence: "MIT" },
      input: { type: "object", properties: { question: { type: "string" } } },
      output: { type: "object", properties: { answer: { type: "string" } } },
    });
    await publishOk(hub, offer);

    const body = await search(hub, { q: "arc question skill answer" });
    const hit = body.results[0];
    if (!hit) throw new Error("missing search hit");

    expect(hit.why).toContain('title has "question"');
    expect(hit.why).toContain('summary has "question"');
    expect(hit.why).toContain('upstream has "arc"');
    expect(hit.why).toContain('takes "question"');
    expect(hit.why).toContain('returns "answer"');
    expect(hit.why).toContain("served by a skill");
    expect(new Set(hit.why).size).toBe(hit.why.length);
  });

  test("the rail filter drops offers without that rail", async () => {
    const escrow = makeOffer({ title: "Arc escrow", rails: ["escrow"] });
    const direct = makeOffer({ title: "Arc direct", rails: ["eip3009"] });
    await publishOk(hub, escrow);
    const directHash = await publishOk(hub, direct);

    const body = await search(hub, { q: "arc", rail: "eip3009" });
    expect(body.results.map((hit) => hit.offerHash)).toEqual([directHash]);
  });

  test("maxPrice drops dearer offers", async () => {
    const cheap = makeOffer({ title: "Arc cheap", price: "1000" });
    const dear = makeOffer({ title: "Arc dear", price: "5000" });
    const cheapHash = await publishOk(hub, cheap);
    await publishOk(hub, dear);

    const body = await search(hub, { q: "arc", maxPrice: "1000" });
    expect(body.results.map((hit) => hit.offerHash)).toEqual([cheapHash]);
  });

  test("a delisted offer never appears", async () => {
    const hidden = makeOffer({ title: "Arc hidden" });
    const shown = makeOffer({ title: "Arc shown" });
    const hiddenHash = await publishOk(hub, hidden);
    const shownHash = await publishOk(hub, shown);
    hub.store.delistOffer(hiddenHash, NOW);

    const body = await search(hub, { q: "arc" });
    expect(body.results.map((hit) => hit.offerHash)).toEqual([shownHash]);
  });

  test("an empty query is 200 with no results", async () => {
    const missing = await fetch(`${hub.url}/offers/search`);
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ query: "", results: [] });

    const blank = await fetch(`${hub.url}/offers/search?q=`);
    expect(blank.status).toBe(200);
    expect(await blank.json()).toEqual({ query: "", results: [] });
  });
});

describe("sellers", () => {
  let hub: TestHub | undefined;

  afterEach(() => {
    hub?.close();
  });

  test("lists each seller with payees, offers, slip-backed counts and identity", async () => {
    const identity: IdentityLookup = async (address) =>
      address.toLowerCase() === seller.address.toLowerCase()
        ? { identityRegistry: REGISTRY, agentId: "77" }
        : null;
    const current = startHubWithIdentity(identity);
    hub = current;

    const alpha = makeOffer({
      title: "Alpha",
      price: "1000",
      rails: ["escrow", "hedera"],
      payTo: { escrow: "0x1111111111111111111111111111111111111111", hedera: "0.0.111" },
    });
    const beta = makeOffer({
      title: "Beta",
      price: "2000",
      rails: ["eip3009"],
      payTo: { eip3009: "0x2222222222222222222222222222222222222222" },
    });
    const gamma = makeOffer({
      seller: other.address,
      title: "Gamma",
      price: "3000",
      rails: ["gateway"],
      payTo: { gateway: "0x3333333333333333333333333333333333333333" },
    });

    const alphaHash = await publishOk(current, alpha);
    const betaHash = await publishOk(current, beta);
    const gammaHash = await publishAs(current, gamma, other);

    const releasedId = id("a1");
    const refundedId = id("b2");
    const failedId = id("c3");
    const releasedSlip = slipFor(releasedId, alphaHash, alpha.seller, "1000", RELEASE_TX);
    current.store.putSlip(releasedSlip.hash, releasedId, releasedSlip, NOW);
    current.store.putJob(
      jobFor({
        jobId: releasedId,
        offerHash: alphaHash,
        rail: "escrow",
        amount: "1000",
        status: "released",
        closeTx: RELEASE_TX,
        slipHash: releasedSlip.hash,
        createdAt: NOW,
        closedAt: NOW + 10,
      }),
    );
    current.store.putJob(
      jobFor({
        jobId: refundedId,
        offerHash: betaHash,
        rail: "eip3009",
        amount: "2000",
        status: "refunded",
        closeTx: REFUND_TX,
        createdAt: NOW + 1,
        closedAt: NOW + 20,
      }),
    );
    current.store.putJob(
      jobFor({
        jobId: failedId,
        offerHash: alphaHash,
        rail: "escrow",
        amount: "700",
        status: "failed",
        createdAt: NOW + 2,
      }),
    );

    const response = await fetch(`${current.url}/sellers`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SellersResponse;
    expect(body.sellers).toHaveLength(2);

    const main = body.sellers.find((entry) => entry.address === seller.address);
    if (!main) throw new Error("missing seller");
    expect(main.name).toBeNull();
    expect(main.payees).toEqual({
      escrow: "0x1111111111111111111111111111111111111111",
      hedera: "0.0.111",
      eip3009: "0x2222222222222222222222222222222222222222",
    });
    expect(main.offers.map((entry) => entry.offerHash).sort()).toEqual([alphaHash, betaHash].sort());
    expect(main.offers.find((entry) => entry.offerHash === alphaHash)).toMatchObject({
      title: alpha.title,
      price: alpha.price,
      rails: alpha.rails,
      online: false,
    });
    expect(main.calls).toBe(3);
    expect(main.released).toBe(1);
    expect(main.settled).toBe(0);
    expect(main.refunded).toBe(1);
    expect(main.failed).toBe(1);
    expect(main.volume).toBe("1000");
    expect(main.erc8004).toEqual({
      agentId: "77",
      identityRegistry: REGISTRY,
      reputation: null,
    });

    const second = body.sellers.find((entry) => entry.address === other.address);
    if (!second) throw new Error("missing second seller");
    expect(second.payees).toEqual({ gateway: "0x3333333333333333333333333333333333333333" });
    expect(second.offers.map((entry) => entry.offerHash)).toEqual([gammaHash]);
    expect(second.calls).toBe(0);
    expect(second.volume).toBe("0");
    expect(second.erc8004).toBeNull();

    expect(body.sellers[0]?.address).toBe(seller.address);
  });

  test("erc8004 is null when no lookup is injected", async () => {
    const current = startHub();
    hub = current;
    await publishOk(current, makeOffer({ title: "Arc without identity" }));

    const response = await fetch(`${current.url}/sellers`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SellersResponse;
    expect(body.sellers).toHaveLength(1);
    expect(body.sellers[0]?.erc8004).toBeNull();
  });
});

describe("settlements", () => {
  let hub: TestHub;
  let runners: RunnerHandle[];

  beforeEach(() => {
    hub = startHub({ rails: [new FakeRail("escrow"), new FakeRail("eip3009", "eip155:1874")] });
    runners = [];
  });

  afterEach(() => {
    for (const runner of runners) runner.close();
    hub.close();
  });

  test("lists two paid calls and a refund newest first", async () => {
    const direct = hub.rails[1];
    if (!direct) throw new Error("missing direct rail");
    const offer = makeOffer({ rails: ["escrow", "eip3009"] });
    const hash = await publishOk(hub, offer);
    let failNext = false;
    const runner = startRunner({
      url: wsUrl(hub),
      account: seller,
      offers: [hash],
      now: () => NOW,
      respond: async () =>
        failNext ? { output: { q: 123 } } : { output: { q: "hello" } },
    });
    runners.push(runner);
    await runner.ready;

    const accepts = (await requirementsFor(hub, hash)).accepts;
    const escrowEntry = accepts[0];
    const directEntry = accepts[1];
    if (!escrowEntry || !directEntry) throw new Error("missing accepts entries");
    const secondNonce = id("d4");
    const thirdNonce = id("e5");

    const first = await call(hub, hash, { q: "hello" }, paymentFor(escrowEntry));
    expect(first.status).toBe(200);
    const second = await call(hub, hash, { q: "hello" }, paymentFor(directEntry, secondNonce));
    expect(second.status).toBe(200);

    failNext = true;
    const third = await call(hub, hash, { q: "hello" }, paymentFor(escrowEntry, thirdNonce));
    expect(third.status).toBe(502);

    hub.setNow(NOW + 61);
    expect(await runJanitor(hub.deps)).toBe(1);

    const response = await fetch(`${hub.url}/settlements`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SettlementsResponse;
    expect(body.settlements).toHaveLength(3);

    const newest = body.settlements[0];
    const middle = body.settlements[1];
    const oldest = body.settlements[2];
    if (!newest || !middle || !oldest) throw new Error("missing settlement");

    expect(newest.kind).toBe("refunded");
    expect(newest.tx).toBe(hub.rail.refundTx);
    expect(newest.explorer).toBe(`https://testnet.arcscan.app/tx/${hub.rail.refundTx}`);
    expect(newest.slipHash).toBeNull();
    expect(newest.jobId).toBe(thirdNonce);

    expect(middle.kind).toBe("settled");
    expect(oldest.kind).toBe("released");
    expect(middle.tx).toBe(direct.settleTx);
    expect(middle.explorer).toBe(`https://testnet.arcscan.app/tx/${direct.settleTx}`);
    expect(middle.slipHash).not.toBeNull();
    expect(oldest.tx).toBe(hub.rail.releaseTx);
    expect(oldest.explorer).toBe(`https://testnet.arcscan.app/tx/${hub.rail.releaseTx}`);
    expect(oldest.slipHash).not.toBeNull();
    expect(oldest.jobId).toBe(NONCE);
    expect(middle.jobId).toBe(secondNonce);

    for (const settlement of body.settlements) {
      expect(settlement.offerHash).toBe(hash);
      expect(settlement.title).toBe(offer.title);
      expect(settlement.seller).toBe(offer.seller);
      expect(settlement.buyer).toBe(BUYER);
      expect(settlement.amount).toBe(offer.price);
      expect(settlement.asset).toBe(ASSET);
      expect(typeof settlement.at).toBe("number");
    }
    expect(newest.rail).toBe("escrow");
    expect(newest.network).toBe(NETWORK);
    expect(middle.rail).toBe("eip3009");
    expect(middle.network).toBe("eip155:1874");
    expect(oldest.rail).toBe("escrow");
    expect(oldest.network).toBe(NETWORK);
    expect(newest.at).toBeGreaterThanOrEqual(oldest.at);
  });

  test("an empty hub returns an empty list", async () => {
    const response = await fetch(`${hub.url}/settlements`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settlements: [] });
  });
});

describe("erc8004 identity", () => {
  test("returns the newest agentId for the owner", async () => {
    const windows: Array<[bigint, bigint]> = [];
    const client: IdentityClient = {
      getBlockNumber: async () => 25_000n,
      getRegisteredLogs: async (query) => {
        windows.push([query.fromBlock, query.toBlock]);
        if (query.fromBlock !== 0n) return [];
        return [
          { blockNumber: 100n, logIndex: 0, agentId: 5n, owner: seller.address },
          { blockNumber: 200n, logIndex: 1, agentId: 7n, owner: seller.address },
          { blockNumber: 200n, logIndex: 3, agentId: 9n, owner: seller.address },
        ];
      },
    };
    const lookup = erc8004IdentityLookup({ registry: REGISTRY, fromBlock: 0, client });

    expect(await lookup(seller.address)).toEqual({
      identityRegistry: REGISTRY,
      agentId: "9",
    });
    expect(windows).toEqual([
      [0n, 9_999n],
      [10_000n, 19_999n],
      [20_000n, 25_000n],
    ]);
  });

  test("returns null when the owner has no registration", async () => {
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      client: {
        getBlockNumber: async () => 10n,
        getRegisteredLogs: async () => [],
      },
    });

    expect(await lookup(seller.address)).toBeNull();
  });

  test("an RPC error is null, never a rejection", async () => {
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      client: {
        getBlockNumber: async () => {
          throw new Error("rpc down");
        },
        getRegisteredLogs: async () => [],
      },
    });

    expect(await lookup(seller.address)).toBeNull();
  });

  test("caches a result for ten minutes", async () => {
    let calls = 0;
    let now = 1_000_000;
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => now,
      client: {
        getBlockNumber: async () => {
          calls += 1;
          return 10n;
        },
        getRegisteredLogs: async () => [
          { blockNumber: 1n, logIndex: 0, agentId: 3n, owner: seller.address },
        ],
      },
    });

    expect(await lookup(seller.address)).toEqual({
      identityRegistry: REGISTRY,
      agentId: "3",
    });
    expect(await lookup(seller.address)).toEqual({
      identityRegistry: REGISTRY,
      agentId: "3",
    });
    expect(calls).toBe(1);

    now += 10 * 60 * 1000 + 1;
    await lookup(seller.address);
    expect(calls).toBe(2);
  });
});

async function search(
  hub: TestHub,
  params: Record<string, string>,
): Promise<SearchResponse> {
  const query = new URLSearchParams(params);
  const response = await fetch(`${hub.url}/offers/search?${query.toString()}`);
  expect(response.status).toBe(200);
  return (await response.json()) as SearchResponse;
}

async function publishAs(
  hub: TestHub,
  offer: Offer,
  signer: typeof seller | typeof other,
): Promise<Hex> {
  const response = await publish(hub, offer, signer);
  if (response.status !== 201) throw new Error(`publish failed with ${response.status}`);
  return ((await response.json()) as { offerHash: Hex }).offerHash;
}

function startHubWithIdentity(identity: IdentityLookup): TestHub {
  const store = new Store(":memory:");
  const rail = new FakeRail("escrow");
  const rails = [rail];
  let now = NOW;
  const deps: HubDeps = {
    store,
    rails,
    now: () => now,
    publicUrl: "http://hub.test",
    jobTimeoutMs: 2_000,
    identity,
  };
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    store,
    rail,
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
}

function id(label: string): Hex {
  const padded = label.padStart(64, "0").slice(-64);
  return `0x${padded}` as Hex;
}

function jobFor(values: {
  jobId: Hex;
  offerHash: Hex;
  rail: JobRecord["rail"];
  amount: string;
  status: JobStatus;
  closeTx?: string | null;
  slipHash?: Hex | null;
  createdAt: number;
  closedAt?: number | null;
}): JobRecord {
  return {
    jobId: values.jobId,
    offerHash: values.offerHash,
    rail: values.rail,
    buyer: BUYER,
    amount: values.amount,
    deadline: values.createdAt + 60,
    status: values.status,
    payment: paymentOf(values.amount, values.rail === "eip3009" ? BUYER : ESCROW),
    settleTx: null,
    closeTx: values.closeTx ?? null,
    slipHash: values.slipHash ?? null,
    createdAt: values.createdAt,
    closedAt: values.closedAt ?? null,
  };
}

function slipFor(
  jobId: Hex,
  offerHash: Hex,
  payTo: string,
  amount: string,
  tx: string,
): Slip {
  const body: SlipBody = {
    v: 1,
    rail: "escrow",
    network: NETWORK,
    offerHash,
    jobId,
    buyer: BUYER,
    seller: seller.address,
    payTo,
    asset: ASSET,
    amount,
    inputHash: ZERO_HASH,
    outputHash: ZERO_HASH,
    
    deliveredAt: NOW,
    children: [],
    escrow: ESCROW,
    chainId: CHAIN_ID,
  };
  const hash = slipHash(body);
  return {
    body,
    hash,
    sellerSig: `0x${"11".repeat(65)}`,
    payment: paymentOf(amount, payTo),
    settlement: {
      transaction: tx,
      network: NETWORK,
      url: `https://testnet.arcscan.app/tx/${tx}`,
    },
  };
}

function paymentOf(amount: string, payTo: string): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network: NETWORK,
      amount,
      asset: ASSET,
      payTo,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}
