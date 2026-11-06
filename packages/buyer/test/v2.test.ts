/**
 * Escrow v2 (D16): a v2-pinned rail countersigns the offer's bond and review window inside
 * jobId. A v1 pin never signs a v2 jobId, and a hub cannot switch the version or the terms.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import {
  canonicalHash,
  jobIdOf,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type CountersignPayload,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type Slip,
} from "@countersign/core";
import { Journal, State, buy, countersignPayer } from "../src/index.ts";
import type { HubClient, KnownRail } from "../src/index.ts";

const BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SELLER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const buyer = privateKeyToAccount(BUYER_KEY);
const seller = privateKeyToAccount(SELLER_KEY);

const CHAIN_ID = 5042002;
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const BOND = "25000";
const WINDOW = 600;
const NOW = 1_762_400_000;

type V2Offer = Offer & { reviewWindow: number };

const offer: V2Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "echoes",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: BOND,
  reviewWindow: WINDOW,
  rails: ["escrow"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

const RAIL: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: CHAIN_ID,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "http://127.0.0.1:1",
};
const V1_RAIL: KnownRail = { ...RAIL };
const V2_RAIL: KnownRail = { ...RAIL, version: 2 };

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
  const dir = mkdtempSync(join(tmpdir(), "cs-v2-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}

function v2Accept(rail: KnownRail, tamper: { bond?: string; reviewWindow?: number; escrowVersion?: number } = {}): PaymentRequirements {
  return {
    scheme: "countersign",
    network: rail.network,
    amount: PRICE,
    asset: rail.token,
    payTo: seller.address,
    maxTimeoutSeconds: offer.deadline,
    extra: {
      rail: "escrow",
      escrow: rail.escrow,
      chainId: rail.chainId,
      offerHash,
      deadlineSeconds: offer.deadline,
      tokenName: rail.tokenName,
      tokenVersion: rail.tokenVersion,
      bond: tamper.bond ?? offer.bond,
      reviewWindow: tamper.reviewWindow ?? offer.reviewWindow,
      escrowVersion: tamper.escrowVersion ?? 2,
    },
  };
}

function v1Accept(rail: KnownRail, tamper: { bond?: string } = {}): PaymentRequirements {
  return {
    scheme: "countersign",
    network: rail.network,
    amount: PRICE,
    asset: rail.token,
    payTo: seller.address,
    maxTimeoutSeconds: offer.deadline,
    extra: {
      rail: "escrow",
      escrow: rail.escrow,
      chainId: rail.chainId,
      offerHash,
      deadlineSeconds: offer.deadline,
      tokenName: rail.tokenName,
      tokenVersion: rail.tokenVersion,
      bond: tamper.bond ?? offer.bond,
    },
  };
}

function fakeHub(rail: KnownRail, accepts: PaymentRequirements[]) {
  let sent = 0;
  let captured: PaymentPayload | undefined;
  const hub = {
    getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
    call: async (_hash: string, input: unknown, payment?: PaymentPayload) => {
      if (!payment) {
        return { kind: "required", required: { x402Version: 2, resource: { url: "x" }, accepts } };
      }
      sent++;
      captured = payment;
      const p = payment.payload as unknown as CountersignPayload;
      const output = { a: "hi" };
      const body = slipBodyFor(
        {
          jobId: p.authorization.nonce,
          offerHash,
          input,
          rail: "escrow",
          network: rail.network,
          buyer: p.terms.buyer,
          payTo: seller.address,
          asset: rail.token,
          amount: PRICE,
          deadline: p.terms.deadline,
          escrow: rail.escrow,
          chainId: rail.chainId,
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
        settlement: { transaction: `0x${"ab".repeat(32)}`, network: rail.network },
      };
      return { kind: "paid", result: { output, slip }, settle: null };
    },
    job: async (jobId: string) => ({ jobId, offerHash, rail: "escrow", status: "refunded", deadline: 0, closeTx: "0xcc" }),
  } as unknown as HubClient;
  return { hub, sent: () => sent, captured: () => captured };
}

function buyOnce(f: ReturnType<typeof fresh>, hub: HubClient, known: KnownRail[]) {
  return buy({
    hub,
    offerHash,
    input: {},
    payers: [countersignPayer(buyer)],
    envelope: envelope(),
    journal: f.journal,
    state: f.state,
    now: NOW,
    known,
  });
}

describe("countersigning escrow v2", () => {
  test("a v2 pin signs the offer's bond and window, and the nonce is the v2 jobId", async () => {
    const f = fresh();
    const { hub, sent, captured } = fakeHub(V2_RAIL, [v2Accept(V2_RAIL)]);
    const res = await buyOnce(f, hub, [V2_RAIL]);
    expect(res.output).toEqual({ a: "hi" });
    expect(sent()).toBe(1);

    const payment = captured() as PaymentPayload;
    const p = payment.payload as unknown as CountersignPayload;
    expect(p.terms.bond).toBe(BOND);
    expect(p.terms.reviewWindow).toBe(WINDOW);

    const v2JobId = jobIdOf(p.terms, CHAIN_ID, ESCROW);
    expect(p.authorization.nonce).toBe(v2JobId);
    expect(v2JobId).not.toBe(jobIdOf({ ...p.terms, bond: undefined, reviewWindow: undefined }, CHAIN_ID, ESCROW));

    const signed = f.journal.entries().find((e) => e.kind === "signed");
    expect(signed).toMatchObject({ jobId: v2JobId, bond: BOND, reviewWindow: WINDOW, escrow: ESCROW, chainId: CHAIN_ID });
  });

  test("a 402 whose bond or window is not the offer's refuses and signs nothing", async () => {
    for (const tamper of [{ bond: "1" }, { reviewWindow: WINDOW + 1 }]) {
      const f = fresh();
      const { hub, sent } = fakeHub(V2_RAIL, [v2Accept(V2_RAIL, tamper)]);
      await expect(buyOnce(f, hub, [V2_RAIL])).rejects.toThrow(
        "Refused. The bond or review window in the payment terms is not the offer's.",
      );
      expect(sent()).toBe(0);
      expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
      expect(f.journal.entries()[0]?.reason).toBe("terms");
    }
  });

  test("a v1 pin facing escrowVersion 2 refuses, so a hub cannot switch versions", async () => {
    const f = fresh();
    const { hub, sent } = fakeHub(V1_RAIL, [v2Accept(V1_RAIL)]);
    await expect(buyOnce(f, hub, [V1_RAIL])).rejects.toThrow(
      "Refused. The escrow version is not the one this agent pinned.",
    );
    expect(sent()).toBe(0);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
  });

  test("a v2 pin facing a 402 without escrowVersion 2 refuses too", async () => {
    const f = fresh();
    const { hub, sent } = fakeHub(V2_RAIL, [v1Accept(V2_RAIL)]);
    await expect(buyOnce(f, hub, [V2_RAIL])).rejects.toThrow(
      "Refused. The escrow version is not the one this agent pinned.",
    );
    expect(sent()).toBe(0);
  });

  test("a v1 pin with a v1 402 signs exactly as before", async () => {
    const f = fresh();
    const { hub, sent, captured } = fakeHub(V1_RAIL, [v1Accept(V1_RAIL)]);
    await buyOnce(f, hub, [V1_RAIL]);
    expect(sent()).toBe(1);

    const p = (captured() as PaymentPayload).payload as unknown as CountersignPayload;
    expect(p.terms.bond).toBeUndefined();
    expect(p.terms.reviewWindow).toBeUndefined();
    const v1JobId = jobIdOf(p.terms, CHAIN_ID, ESCROW);
    expect(p.authorization.nonce).toBe(v1JobId);

    const signed = f.journal.entries().find((e) => e.kind === "signed");
    expect(signed?.jobId).toBe(v1JobId);
    expect(signed?.bond).toBeUndefined();
    expect(signed?.reviewWindow).toBeUndefined();
  });
});

