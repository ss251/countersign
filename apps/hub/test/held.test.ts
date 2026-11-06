import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  offerHash,
  type CallResult,
  type ErrorBody,
  type EscrowOps,
  type JobOrder,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type Rail,
  type RailDeclaration,
  type SettleResult,
  type VerifyResult,
} from "../src/deps.ts";
import { railsFromEnv } from "../src/rails.ts";
import type { FakeRail } from "./fake-rail.ts";
import {
  call,
  makeOffer,
  NOW,
  publishOk,
  requirementsFor,
  seller,
  startHub,
  wsUrl,
  type TestHub,
} from "./support.ts";
import { startRunner, type JobAnswer, type RunnerHandle } from "./runner-client.ts";

const NETWORK = "hedera:testnet" as const;
const ASSET = "0.0.429274";
const PAYER = "0.0.11337064";
const HELD_PAYEE = "0.0.11338176";
const DIRECT_PAYEE = "0.0.11337065";
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@1700000000.000000000`;
const COUNTERSIGN = "c2lnbmVk";
const NOTHING_CHARGED =
  "Not delivered. This hub will not submit the seller's countersignature. Your USDC stays in your account unless the seller signs the schedule itself before it expires.";

interface ReleaseArgs {
  jobId: Hex;
  slipHash: Hex;
  sellerSig: Hex;
  countersign?: string;
}

class HeldFakeRail implements Rail {
  readonly declaration: RailDeclaration = {
    id: "hedera-scheduled",
    network: NETWORK,
    scheme: "countersign",
    asset: { network: NETWORK, address: ASSET, symbol: "USDC", decimals: 6 },
    kind: "escrow",
    gasPaidBy: "buyer",
    finality: "Hedera consensus when the seller's countersignature lands",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
    finalitySeconds: 5,
    cost: { tollBps: 0, fixed: "0" },
  };

  readonly releaseCalls: ReleaseArgs[] = [];

  readonly escrow: EscrowOps = {
    release: async (jobId, slipHash, sellerSig, countersign) => {
      this.releaseCalls.push({ jobId, slipHash, sellerSig, countersign });
      return this.result();
    },
    refund: async () => this.result(),
    cancel: async () => this.result(),
    status: async () => "funded",
  };

  challenge(offer: Offer, _ctx: { resource: string; now: number }): PaymentRequirements {
    return {
      scheme: "countersign",
      network: NETWORK,
      amount: offer.price,
      asset: ASSET,
      payTo: offer.payTo?.["hedera-scheduled"] ?? "",
      maxTimeoutSeconds: offer.deadline,
      extra: {
        name: "hedera-scheduled",
        offerHash: offerHash(offer),
        holdSeconds: offer.deadline + 180,
      },
    };
  }

  async verify(): Promise<VerifyResult> {
    return { isValid: true, payer: PAYER };
  }

  async settle(): Promise<SettleResult> {
    return { success: true, payer: PAYER, transaction: CREATE_TX, network: NETWORK };
  }

  private result(): SettleResult {
    return { success: true, payer: PAYER, transaction: CREATE_TX, network: NETWORK };
  }
}

class DirectHederaRail implements Rail {
  readonly declaration: RailDeclaration = {
    id: "hedera",
    network: NETWORK,
    scheme: "exact",
    asset: { network: NETWORK, address: ASSET, symbol: "USDC", decimals: 6 },
    kind: "direct",
    gasPaidBy: "facilitator",
    finality: "Final at Hedera consensus, a few seconds after the facilitator submits.",
    explorerTx: "https://hashscan.io/testnet/transaction/{tx}",
    finalitySeconds: 5,
    cost: { tollBps: 0, fixed: "0" },
  };

  challenge(offer: Offer, _ctx: { resource: string; now: number }): PaymentRequirements {
    return {
      scheme: "exact",
      network: NETWORK,
      amount: offer.price,
      asset: ASSET,
      payTo: offer.payTo?.hedera ?? DIRECT_PAYEE,
      maxTimeoutSeconds: offer.deadline,
      extra: { name: "hedera" },
    };
  }

  async verify(): Promise<VerifyResult> {
    return { isValid: true, payer: PAYER };
  }

  async settle(): Promise<SettleResult> {
    return { success: true, payer: PAYER, transaction: CREATE_TX, network: NETWORK };
  }
}

function heldOffer(over: Partial<Offer> = {}): Offer {
  return makeOffer({
    rails: ["hedera-scheduled"],
    payTo: { "hedera-scheduled": HELD_PAYEE },
    ...over,
  });
}

function hubFor(rails: Rail[]): TestHub {
  return startHub({ rails: rails as unknown as FakeRail[] });
}

function heldPayment(entry: PaymentRequirements): PaymentPayload {
  return {
    x402Version: 2,
    accepted: entry,
    payload: { scheduleId: SCHEDULE_ID, createTxId: CREATE_TX },
  };
}

async function connect(
  hub: TestHub,
  hash: Hex,
  respond: (order: JobOrder) => Promise<JobAnswer>,
): Promise<{ runner: RunnerHandle; orders: JobOrder[] }> {
  const orders: JobOrder[] = [];
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond: async (order) => {
      orders.push(order);
      return respond(order);
    },
  });
  await runner.ready;
  return { runner, orders };
}

describe("a held Hedera call", () => {
  test("carries the schedule to the runner and the countersignature to release", async () => {
    const rail = new HeldFakeRail();
    const hub = hubFor([rail]);
    const hash = await publishOk(hub, heldOffer());
    const { runner, orders } = await connect(hub, hash, async () => ({
      output: { q: "hello" },
      countersign: COUNTERSIGN,
    }));

    try {
      const entry = (await requirementsFor(hub, hash)).accepts[0];
      if (!entry) throw new Error("missing accepts entry");
      const response = await call(hub, hash, { q: "hello" }, heldPayment(entry));
      expect(response.status).toBe(200);

      const result = (await response.json()) as CallResult;
      expect(orders).toHaveLength(1);
      expect(orders[0]!.schedule).toEqual({ id: SCHEDULE_ID, createTx: CREATE_TX });
      expect(rail.releaseCalls).toHaveLength(1);
      expect(rail.releaseCalls[0]!.countersign).toBe(COUNTERSIGN);
      expect(result.slip.settlement.transaction).toBe(CREATE_TX);
    } finally {
      runner.close();
      hub.close();
    }
  });

  test("a failed runner never reaches release", async () => {
    const rail = new HeldFakeRail();
    const hub = hubFor([rail]);
    const hash = await publishOk(hub, heldOffer());
    const { runner } = await connect(hub, hash, async () => ({ fail: "the tool refused" }));

    try {
      const entry = (await requirementsFor(hub, hash)).accepts[0];
      if (!entry) throw new Error("missing accepts entry");
      const response = await call(hub, hash, { q: "hello" }, heldPayment(entry));
      expect(response.status).toBe(502);

      const body = (await response.json()) as ErrorBody;
      expect(body.message).toBe(NOTHING_CHARGED);
      expect(rail.releaseCalls).toHaveLength(0);
    } finally {
      runner.close();
      hub.close();
    }
  });

  test("an output that fails the gate never reaches release", async () => {
    const rail = new HeldFakeRail();
    const hub = hubFor([rail]);
    const hash = await publishOk(hub, heldOffer());
    const { runner } = await connect(hub, hash, async () => ({ output: { q: 123 } }));

    try {
      const entry = (await requirementsFor(hub, hash)).accepts[0];
      if (!entry) throw new Error("missing accepts entry");
      const response = await call(hub, hash, { q: "hello" }, heldPayment(entry));
      expect(response.status).toBe(502);
      expect(rail.releaseCalls).toHaveLength(0);
    } finally {
      runner.close();
      hub.close();
    }
  });
});

describe("the held rail in the router", () => {
  test("is offered before the direct hedera rail", async () => {
    const hub = hubFor([new HeldFakeRail(), new DirectHederaRail()]);
    const hash = await publishOk(
      hub,
      heldOffer({
        rails: ["hedera", "hedera-scheduled"],
        payTo: { hedera: DIRECT_PAYEE, "hedera-scheduled": HELD_PAYEE },
      }),
    );
    const { runner } = await connect(hub, hash, async () => ({ output: { q: "hello" } }));

    try {
      const response = await call(hub, hash, { q: "hello" });
      expect(response.status).toBe(402);
      const body = (await response.json()) as { accepts: PaymentRequirements[] };
      expect(body.accepts).toHaveLength(2);
      expect(body.accepts[0]!.extra?.name).toBe("hedera-scheduled");
      expect(body.accepts[1]!.extra?.name).toBe("hedera");
    } finally {
      runner.close();
      hub.close();
    }
  });
});

describe("railsFromEnv hedera-scheduled", () => {
  test("starts the rail only when its flag is set", async () => {
    const fake = { declaration: { id: "hedera-scheduled" } } as unknown as Rail;
    const lines: string[] = [];
    const on = await railsFromEnv(
      { HEDERA_SCHEDULED_RAIL: "1" },
      { hederaScheduled: async () => fake },
      (line) => lines.push(line),
    );
    expect(on.map((rail) => rail.declaration.id)).toEqual(["hedera-scheduled"]);
    expect(lines).toEqual([]);

    const off = await railsFromEnv({}, { hederaScheduled: async () => fake }, () => undefined);
    expect(off).toEqual([]);
  });
});
