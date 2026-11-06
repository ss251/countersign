import { describe, expect, test } from "bun:test";
import type { Hex } from "viem";
import {
  offerHash,
  type CallResult,
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
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@1700000000.000000000`;
const EXECUTION_REF = "1793978983.950527764";
const COUNTERSIGN = "c2lnbmVk";

class HeldLinkFakeRail implements Rail {
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

  private readonly explorerRef: string | undefined;

  constructor(explorerRef?: string) {
    this.explorerRef = explorerRef;
  }

  readonly escrow: EscrowOps = {
    release: async () => this.released(),
    refund: async () => this.released(),
    cancel: async () => this.released(),
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

  private released(): SettleResult {
    return {
      success: true,
      payer: PAYER,
      transaction: CREATE_TX,
      network: NETWORK,
      ...(this.explorerRef === undefined ? {} : { explorerRef: this.explorerRef }),
    };
  }
}

function heldOffer(): Offer {
  return makeOffer({
    rails: ["hedera-scheduled"],
    payTo: { "hedera-scheduled": HELD_PAYEE },
  });
}

function hubFor(rail: Rail): TestHub {
  return startHub({ rails: [rail] as unknown as FakeRail[] });
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
): Promise<RunnerHandle> {
  const runner = startRunner({
    url: wsUrl(hub),
    account: seller,
    offers: [hash],
    now: () => NOW,
    respond,
  });
  await runner.ready;
  return runner;
}

async function heldCall(rail: Rail): Promise<CallResult> {
  const hub = hubFor(rail);
  const hash = await publishOk(hub, heldOffer());
  const runner = await connect(hub, hash, async () => ({
    output: { q: "hello" },
    countersign: COUNTERSIGN,
  }));

  try {
    const entry = (await requirementsFor(hub, hash)).accepts[0];
    if (!entry) throw new Error("missing accepts entry");
    const response = await call(hub, hash, { q: "hello" }, heldPayment(entry));
    expect(response.status).toBe(200);
    return (await response.json()) as CallResult;
  } finally {
    runner.close();
    hub.close();
  }
}

describe("a held settlement's explorer link", () => {
  test("opens the scheduled execution while the transaction stays the create", async () => {
    const result = await heldCall(new HeldLinkFakeRail(EXECUTION_REF));
    expect(result.slip.settlement.url?.endsWith(`/transaction/${EXECUTION_REF}`)).toBe(true);
    expect(result.slip.settlement.transaction).toBe(CREATE_TX);
  });

  test("falls back to the transaction when the release has no explorer ref", async () => {
    const result = await heldCall(new HeldLinkFakeRail());
    expect(result.slip.settlement.url).toBe(
      `https://hashscan.io/testnet/transaction/${encodeURIComponent(CREATE_TX)}`,
    );
    expect(result.slip.settlement.transaction).toBe(CREATE_TX);
  });
});
