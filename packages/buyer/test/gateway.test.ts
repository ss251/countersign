import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  canonicalHash,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type Slip,
} from "@countersign/core";
import {
  Journal,
  KNOWN_GATEWAYS,
  State,
  buy,
  gatewayPayer,
  type HubClient,
} from "../src/index.ts";

// Fixed anvil keys; they hold nothing anywhere else.
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const thief = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const PRICE = "250000";
const NOW = 1_762_400_000;
const GATEWAY = KNOWN_GATEWAYS[0]!;
const RESOURCE = {
  url: "http://hub.test/offers/0x00/call",
  description: "Gateway echo",
  mimeType: "application/json",
};

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Gateway echo",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["gateway"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

function accept(over: { payTo?: string; amount?: string; asset?: string; verifyingContract?: string } = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:5042002",
    amount: over.amount ?? PRICE,
    asset: over.asset ?? GATEWAY.asset,
    payTo: over.payTo ?? seller.address,
    maxTimeoutSeconds: 120,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: over.verifyingContract ?? GATEWAY.verifyingContract,
    },
  };
}

function envelope(): Envelope {
  return {
    v: 1,
    agent: buyer.address,
    cap: "10000000",
    perMerchant: "10000000",
    allowlist: [seller.address],
    revoked: false,
  };
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "cs-gateway-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}

function fakeHub(accepts: PaymentRequirements[]) {
  let paidPayment: PaymentPayload | undefined;
  let paidCalls = 0;
  const hub = {
    getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
    call: async (_hash: string, input: unknown, payment?: PaymentPayload) => {
      if (!payment) {
        const required: PaymentRequired = { x402Version: 2, resource: RESOURCE, accepts };
        return { kind: "required", required };
      }
      paidCalls += 1;
      paidPayment = payment;
      const authorization = payment.payload.authorization as { nonce: Hex };
      const output = { ok: true };
      const body = slipBodyFor(
        {
          jobId: authorization.nonce,
          offerHash,
          input,
          rail: "gateway",
          network: "eip155:5042002",
          buyer: buyer.address,
          payTo: seller.address,
          asset: GATEWAY.asset,
          amount: PRICE,
          deadline: NOW + 120,
          lineage: [],
        },
        seller.address,
        canonicalHash(input),
        canonicalHash(output),
        NOW + 1,
      );
      const slip: Slip = {
        body,
        hash: slipHash(body),
        sellerSig: await seller.signTypedData(slipTypedData(body)),
        payment,
        settlement: { transaction: "0b7c2d27-9a4d-4f6e-b0bd-61a4b1b8c3aa", network: "eip155:5042002" },
      };
      return { kind: "paid", result: { output, slip }, settle: null };
    },
  } as unknown as HubClient;
  return {
    hub,
    paidPayment: () => paidPayment,
    paidCalls: () => paidCalls,
  };
}

function buyOnce(f: ReturnType<typeof fresh>, hub: HubClient, extra: { rail?: "gateway" } = {}) {
  return buy({
    hub,
    offerHash,
    input: {},
    payers: [gatewayPayer(buyer)],
    envelope: envelope(),
    journal: f.journal,
    state: f.state,
    now: NOW,
    known: [],
    ...extra,
  });
}

describe("gatewayPayer", () => {
  test("canPay is true only for the pinned Gateway", () => {
    const payer = gatewayPayer(buyer);
    expect(payer.canPay(accept())).toBe(true);
    expect(payer.canPay(accept({ verifyingContract: thief.address }))).toBe(false);
    expect(payer.canPay(accept({ asset: thief.address }))).toBe(false);
    expect(payer.canPay(accept({ amount: "1" }))).toBe(true);
  });

  test("pay copies the resource and returns the authorisation nonce", async () => {
    const payer = gatewayPayer(buyer);
    const req = accept();
    const signed = await payer.pay(req, { now: NOW, resource: RESOURCE });

    expect(signed.payment.resource).toEqual(RESOURCE);
    expect(signed.jobId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect((signed.payment.payload.authorization as { nonce: Hex }).nonce).toBe(signed.jobId);
  });
});

describe("gateway terms", () => {
  test("a payTo that is not the offer's seller is refused before signing", async () => {
    const f = fresh();
    const { hub, paidCalls } = fakeHub([accept({ payTo: thief.address })]);

    await expect(buyOnce(f, hub)).rejects.toThrow(
      "Refused. The payment terms pay someone other than the offer's seller.",
    );
    expect(paidCalls()).toBe(0);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
    expect(f.journal.entries()[0]?.reason).toBe("terms");
  });

  test("an amount other than the offer's price is refused before signing", async () => {
    const f = fresh();
    const { hub, paidCalls } = fakeHub([accept({ amount: "1" })]);

    await expect(buyOnce(f, hub)).rejects.toThrow(
      "Refused. The payment terms ask a different amount than the offer's price.",
    );
    expect(paidCalls()).toBe(0);
  });

  test("an unknown Gateway wallet is not payable and is never signed", async () => {
    const f = fresh();
    const { hub, paidCalls } = fakeHub([accept({ verifyingContract: thief.address })]);

    await expect(buyOnce(f, hub)).rejects.toThrow(
      "Refused. No rail here that this agent can pay.",
    );
    expect(paidCalls()).toBe(0);
    expect(f.journal.entries()).toEqual([]);
  });
});

describe("gateway buy", () => {
  test("a full fake-hub purchase journals settled and keeps the resource", async () => {
    const f = fresh();
    const { hub, paidPayment } = fakeHub([accept()]);

    const result = await buyOnce(f, hub, { rail: "gateway" });

    expect(result.output).toEqual({ ok: true });
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "signed", "settled"]);
    expect(f.journal.entries().at(-1)?.rail).toBe("gateway");
    expect(f.journal.entries().at(-1)?.closeTx).toBe(result.slip.settlement.transaction);
    expect(paidPayment()?.resource).toEqual(RESOURCE);
  });

  test("--rail gateway skips a countersign-like entry", async () => {
    const f = fresh();
    const { hub, paidCalls } = fakeHub([accept()]);

    const result = await buyOnce(f, hub, { rail: "gateway" });
    expect(result.slip.body.rail).toBe("gateway");
    expect(paidCalls()).toBe(1);
  });
});
