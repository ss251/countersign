import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { offerHash, type Network, type Offer, type PaymentPayload, type RailId } from "../src/deps.ts";
import type {
  EscrowOps,
  PaymentRequirements,
  Rail,
  RailDeclaration,
  SettleResult,
  VerifyResult,
} from "../src/deps.ts";
import { createHub, type HubDeps } from "../src/app.ts";
import type { Order, Refund } from "../src/orders.ts";
import { Store, type JobStatus } from "../src/store.ts";
import { makeOffer, NOW } from "./support.ts";

const ASSET = "0x3600000000000000000000000000000000000000";
const ESCROW = "0x4444444444444444444444444444444444444444";
const SELLER: Address = "0x1000000000000000000000000000000000000001";
const OTHER_SELLER: Address = "0x1000000000000000000000000000000000000002";
const BUYER: Address = "0x1000000000000000000000000000000000000003";
const ARC: Network = "eip155:5042002";
const WHITECHAIN: Network = "eip155:1874";
const RELAY_FEE = "50";
const RELAY_REFUNDED = "20";
const RELAY_REFUNDABLE = "30";
const RELAY_REFUND_TX = `0x${"dd".repeat(32)}`;
const REFUND: Refund = {
  amount: "20",
  txHash: RELAY_REFUND_TX,
  blockNumber: 7,
  status: "confirmed",
  reason: null,
  at: NOW * 1000,
};

class OrdersRail implements Rail {
  readonly declaration: RailDeclaration;
  readonly escrow?: EscrowOps;

  constructor(declaration: RailDeclaration, tollBps?: number) {
    this.declaration = declaration;
    if (declaration.kind === "escrow") {
      const settled: SettleResult = { success: true, transaction: "", network: declaration.network };
      this.escrow = {
        release: async () => settled,
        refund: async () => settled,
        cancel: async () => settled,
        status: async () => "funded",
        ...(tollBps === undefined ? {} : { tollBps: async () => tollBps }),
      };
    }
  }

  challenge(): PaymentRequirements {
    throw new Error("not used in these tests");
  }

  async verify(): Promise<VerifyResult> {
    return { isValid: false, invalidReason: "not used in these tests" };
  }

  async settle(): Promise<SettleResult> {
    return { success: false, errorReason: "not used in these tests", transaction: "", network: this.declaration.network };
  }
}

function declaration(
  id: RailId,
  network: Network,
  symbol: string,
  kind: RailDeclaration["kind"],
  explorerTx: string,
): RailDeclaration {
  return {
    id,
    network,
    scheme: "countersign",
    asset: { network, address: ASSET, symbol, decimals: 6 },
    kind,
    ...(kind === "escrow" ? { escrow: ESCROW } : {}),
    gasPaidBy: "hub",
    finality: "One test block.",
    explorerTx,
  };
}

const escrowRail = new OrdersRail(
  declaration("escrow", ARC, "USDC", "escrow", "https://testnet.arcscan.app/tx/{tx}"),
  100,
);
const gatewayRail = new OrdersRail(declaration("gateway", ARC, "USDC", "batched", ""));
const whitechainRail = new OrdersRail(
  declaration("whitechain", WHITECHAIN, "USDT", "escrow", "https://explorer.testnet.whitechain.io/tx/{tx}"),
);

interface TestStore {
  store: Store;
  cleanup: () => void;
}

let openHubs: Array<() => void> = [];
let stores: TestStore[] = [];

afterEach(() => {
  for (const close of openHubs) close();
  openHubs = [];
  for (const { cleanup } of stores) cleanup();
  stores = [];
});

function tempStore(): TestStore {
  const dir = mkdtempSync(join(tmpdir(), "cs-orders-"));
  const store = new Store(join(dir, "hub.sqlite"));
  const entry = { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  stores.push(entry);
  return entry;
}

function startOrdersHub(store: Store, rails: Rail[], relayUrl?: string): string {
  const deps: HubDeps = {
    store,
    rails,
    now: () => NOW,
    publicUrl: "http://hub.test",
    ...(relayUrl === undefined ? {} : { relayUrl }),
  };
  const { app, websocket, runners } = createHub(deps);
  const server = Bun.serve({
    port: 0,
    fetch: (request, bunServer) => app.fetch(request, bunServer),
    websocket,
  });
  openHubs.push(() => {
    runners.stop();
    server.stop(true);
  });
  return `http://127.0.0.1:${server.port}`;
}

function payment(amount: string, network: Network, payTo: Address): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network,
      amount,
      asset: ASSET,
      payTo,
      maxTimeoutSeconds: 120,
    },
    payload: {},
  };
}

function seedOffer(store: Store, seller: Address, title: string): Hex {
  const offer: Offer = makeOffer({ seller, title });
  const hash = offerHash(offer);
  store.putOffer(hash, seller, offer, NOW);
  return hash;
}

interface SeedJob {
  jobId: Hex;
  offerHash: Hex;
  rail: RailId;
  buyer: Address;
  payTo: Address;
  amount: string;
  status: JobStatus;
  createdAt: number;
  network?: Network;
  settleTx?: string | null;
  closeTx?: string | null;
  closedAt?: number | null;
}

function seedJob(store: Store, job: SeedJob): void {
  const network = job.network ?? ARC;
  store.putJob({
    jobId: job.jobId,
    offerHash: job.offerHash,
    rail: job.rail,
    buyer: job.buyer,
    amount: job.amount,
    deadline: NOW + 120,
    status: job.status,
    payment: payment(job.amount, network, job.payTo),
    settleTx: job.settleTx ?? null,
    closeTx: job.closeTx ?? null,
    slipHash: null,
    createdAt: job.createdAt,
    closedAt: job.closedAt ?? null,
  });
}

interface SeededSeller {
  released: Hex;
  settled: Hex;
  refunded: Hex;
  failed: Hex;
  releasedSettleTx: string;
  releasedCloseTx: string;
  offerHash: Hex;
}

function seedSellerJobs(store: Store): SeededSeller {
  const hash = seedOffer(store, SELLER, "Seller's offer");
  const otherHash = seedOffer(store, OTHER_SELLER, "Other seller's offer");
  const released = `0x${"01".repeat(32)}` as Hex;
  const settled = `0x${"02".repeat(32)}` as Hex;
  const refunded = `0x${"03".repeat(32)}` as Hex;
  const failed = `0x${"04".repeat(32)}` as Hex;
  const releasedSettleTx = `0x${"aa".repeat(32)}`;
  const releasedCloseTx = `0x${"bb".repeat(32)}`;

  seedJob(store, {
    jobId: released,
    offerHash: hash,
    rail: "escrow",
    buyer: BUYER,
    payTo: SELLER,
    amount: "10000",
    status: "released",
    createdAt: 1_000,
    settleTx: releasedSettleTx,
    closeTx: releasedCloseTx,
    closedAt: 1_005,
  });
  seedJob(store, {
    jobId: settled,
    offerHash: hash,
    rail: "gateway",
    buyer: BUYER,
    payTo: SELLER,
    amount: "2000",
    status: "settled",
    createdAt: 2_000,
    settleTx: `0x${"cc".repeat(32)}`,
  });
  seedJob(store, {
    jobId: refunded,
    offerHash: hash,
    rail: "escrow",
    buyer: BUYER,
    payTo: SELLER,
    amount: "3000",
    status: "refunded",
    createdAt: 3_000,
    closeTx: `0x${"ee".repeat(32)}`,
    closedAt: 3_010,
  });
  seedJob(store, {
    jobId: failed,
    offerHash: hash,
    rail: "escrow",
    buyer: BUYER,
    payTo: SELLER,
    amount: "4000",
    status: "failed",
    createdAt: 4_000,
  });
  seedJob(store, {
    jobId: `0x${"05".repeat(32)}`,
    offerHash: otherHash,
    rail: "escrow",
    buyer: BUYER,
    payTo: OTHER_SELLER,
    amount: "5000",
    status: "released",
    createdAt: 5_000,
    closeTx: `0x${"ff".repeat(32)}`,
    closedAt: 5_010,
  });

  return { released, settled, refunded, failed, releasedSettleTx, releasedCloseTx, offerHash: hash };
}

async function ordersAt(url: string, query: string): Promise<{ response: Response; orders: Order[] }> {
  const response = await fetch(`${url}/orders?${query}`);
  const body = (await response.json()) as { orders: Order[] };
  return { response, orders: body.orders };
}

describe("GET /orders", () => {
  test("lists one seller's orders newest first with the contract's fields", async () => {
    const { store } = tempStore();
    const url = startOrdersHub(store, [escrowRail, gatewayRail]);
    const ids = seedSellerJobs(store);

    const { response, orders } = await ordersAt(url, `seller=${SELLER}`);
    expect(response.status).toBe(200);
    expect(orders.map((order) => order.id)).toEqual([ids.failed, ids.refunded, ids.settled, ids.released]);

    const released = orders[3];
    expect(released).toBeDefined();
    if (released === undefined) return;
    expect(released.kind).toBe("escrow");
    expect(released.rail).toBe("escrow");
    expect(released.network).toBe("eip155:5042002");
    expect(released.networkName).toBe("Arc testnet");
    expect(released.asset).toEqual({ symbol: "USDC", decimals: 6 });
    expect(released.explorer).toBe("https://testnet.arcscan.app");
    expect(released.customer).toBe(BUYER);
    expect(released.merchant).toBe(SELLER);
    expect(released.amount).toBe("10000");
    expect(released.fee).toBe("100");
    expect(released.refunded).toBe("0");
    expect(released.refundable).toBe("0");
    expect(released.status).toBe("paid");
    expect(released.closeKind).toBe("release");
    expect(released.createdAt).toBe(1_000_000);
    expect(released.deadline).toBe((NOW + 120) * 1000);
    expect(released.receivedAt).toBe(1_005_000);
    expect(released.closedAt).toBe(1_005_000);
    expect(released.settleTx).toBe(ids.releasedSettleTx);
    expect(released.closeTx).toBe(ids.releasedCloseTx);
    expect(released.refundTxs).toEqual([]);
    expect(released.slipHash).toBeNull();
    expect(released.offerHash).toBe(ids.offerHash);
    expect(released.description).toBe("Seller's offer");
    expect(released.settleTxUrl).toBe(`https://testnet.arcscan.app/tx/${ids.releasedSettleTx}`);
    expect(released.closeTxUrl).toBe(`https://testnet.arcscan.app/tx/${ids.releasedCloseTx}`);

    const settled = orders[2];
    expect(settled).toBeDefined();
    if (settled === undefined) return;
    expect(settled.kind).toBe("exact");
    expect(settled.rail).toBe("gateway");
    expect(settled.status).toBe("paid");
    expect(settled.closeKind).toBeNull();
    expect(settled.fee).toBe("0");
    expect(settled.receivedAt).toBe(2_000_000);
    expect(settled.explorer).toBeNull();

    const refunded = orders[1];
    expect(refunded).toBeDefined();
    if (refunded === undefined) return;
    expect(refunded.status).toBe("refunded");
    expect(refunded.closeKind).toBe("deadline_refund");
    expect(refunded.refunded).toBe("3000");
    expect(refunded.receivedAt).toBeNull();

    const failed = orders[0];
    expect(failed).toBeDefined();
    if (failed === undefined) return;
    expect(failed.status).toBe("refund_pending");
    expect(failed.closeKind).toBeNull();
    expect(failed.receivedAt).toBeNull();
  });

  test("matches case-insensitively, pages, and refuses malformed addresses", async () => {
    const { store } = tempStore();
    const url = startOrdersHub(store, [escrowRail, gatewayRail]);
    const ids = seedSellerJobs(store);

    const upper = `0x${SELLER.slice(2).toUpperCase()}`;
    const upperResult = await ordersAt(url, `seller=${upper}`);
    expect(upperResult.response.status).toBe(200);
    expect(upperResult.orders).toHaveLength(4);

    const unknown = await ordersAt(url, `seller=${OTHER_SELLER}`);
    expect(unknown.response.status).toBe(200);
    expect(unknown.orders).toHaveLength(1);

    const nobody = await ordersAt(url, `seller=0x${"99".repeat(20)}`);
    expect(nobody.response.status).toBe(200);
    expect(nobody.orders).toEqual([]);

    const malformedResponse = await fetch(`${url}/orders?seller=not-an-address`);
    const malformed = (await malformedResponse.json()) as { code: string; message: string };
    expect(malformedResponse.status).toBe(400);
    expect(malformed.code).toBe("bad-request");
    expect(malformed.message).toBe("Refused. Name the seller.");

    const limited = await ordersAt(url, `seller=${SELLER}&limit=1`);
    expect(limited.response.status).toBe(200);
    expect(limited.orders.map((order) => order.id)).toEqual([ids.failed]);
  });
});

describe("GET /orders/:id", () => {
  test("returns one order with its refunds", async () => {
    const { store } = tempStore();
    const url = startOrdersHub(store, [escrowRail, gatewayRail]);
    const ids = seedSellerJobs(store);

    const response = await fetch(`${url}/orders/${ids.released}`);
    expect(response.status).toBe(200);
    const order = (await response.json()) as Order & { refunds: Refund[] };
    expect(order.id).toBe(ids.released);
    expect(order.description).toBe("Seller's offer");
    expect(order.refunds).toEqual([]);
  });

  test("an unknown id is a bare 404", async () => {
    const { store } = tempStore();
    const url = startOrdersHub(store, [escrowRail, gatewayRail]);

    const response = await fetch(`${url}/orders/0xdeadbeef`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found" });
  });
});

describe("GET /orders with the Whitechain relay", () => {
  test("takes the relay's refunds and fees, and survives the relay going away", async () => {
    const { store } = tempStore();
    const jobId = `0x${"11".repeat(32)}` as Hex;
    const hash = seedOffer(store, SELLER, "Whitechain sale");
    seedJob(store, {
      jobId,
      offerHash: hash,
      rail: "whitechain",
      buyer: BUYER,
      payTo: SELLER,
      amount: "5000",
      status: "released",
      createdAt: 1_000,
      network: WHITECHAIN,
      settleTx: `0x${"12".repeat(32)}`,
      closeTx: `0x${"13".repeat(32)}`,
      closedAt: 1_010,
    });

    const relay = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path !== `/orders/${jobId}`) return new Response("not found", { status: 404 });
        return Response.json({
          fee: RELAY_FEE,
          refunded: RELAY_REFUNDED,
          refundable: RELAY_REFUNDABLE,
          refundTxs: [RELAY_REFUND_TX],
          status: "partially_refunded",
          closeKind: "release",
          refunds: [REFUND],
        });
      },
    });
    let relayOpen = true;

    try {
      const url = startOrdersHub(store, [whitechainRail], `http://127.0.0.1:${relay.port}`);
      const listed = await ordersAt(url, `seller=${SELLER}`);
      expect(listed.response.status).toBe(200);
      const order = listed.orders[0];
      expect(order).toBeDefined();
      if (order === undefined) return;
      expect(order.status).toBe("partially_refunded");
      expect(order.closeKind).toBe("release");
      expect(order.fee).toBe(RELAY_FEE);
      expect(order.refunded).toBe(RELAY_REFUNDED);
      expect(order.refundable).toBe(RELAY_REFUNDABLE);
      expect(order.refundTxs).toEqual([RELAY_REFUND_TX]);
      expect(order.relayUnavailable).toBeUndefined();

      const single = (await fetch(`${url}/orders/${jobId}`).then((r) => r.json())) as Order & {
        refunds: Refund[];
      };
      expect(single.status).toBe("partially_refunded");
      expect(single.fee).toBe(RELAY_FEE);
      expect(single.refunds).toEqual([REFUND]);

      relay.stop(true);
      relayOpen = false;

      const offline = await ordersAt(url, `seller=${SELLER}`);
      expect(offline.response.status).toBe(200);
      const kept = offline.orders[0];
      expect(kept).toBeDefined();
      if (kept === undefined) return;
      expect(kept.status).toBe("paid");
      expect(kept.closeKind).toBe("release");
      expect(kept.fee).toBe("0");
      expect(kept.refunded).toBe("0");
      expect(kept.refundable).toBe("0");
      expect(kept.refundTxs).toEqual([]);
      expect(kept.relayUnavailable).toBe(true);

      const offlineSingle = (await fetch(`${url}/orders/${jobId}`).then((r) => r.json())) as Order & {
        refunds: Refund[];
      };
      expect(offlineSingle.relayUnavailable).toBe(true);
      expect(offlineSingle.refunds).toEqual([]);
    } finally {
      if (relayOpen) relay.stop(true);
    }
  });
});
