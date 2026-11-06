import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  canonicalHash,
  slipBodyFor,
  slipHash,
  slipTypedData,
  type CountersignExtra,
  type CountersignPayload,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type PaymentRequirements,
  type Slip,
} from "@countersign/core";
import { BuyError, Journal, KNOWN_RAILS, State, buy, countersignPayer, resume } from "../src/index.ts";
import type { HubClient, KnownRail } from "../src/index.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const buyer = privateKeyToAccount(generatePrivateKey());
const thief = privateKeyToAccount(generatePrivateKey());
const PRICE = "250000";
const NOW = 1_762_400_000;

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

const RAIL: KnownRail = {
  network: "eip155:31337",
  scheme: "countersign",
  chainId: 31337,
  escrow: "0x5555555555555555555555555555555555555555",
  token: "0x6666666666666666666666666666666666666666",
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "http://127.0.0.1:1",
};

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    agent: buyer.address,
    cap: "10000000",
    perMerchant: "10000000",
    allowlist: [seller.address],
    revoked: false,
    ...over,
  };
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "cs-terms-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}

interface Tamper {
  escrow?: Address;
  token?: Address;
  payTo?: Address;
  amount?: string;
  offerHash?: Hex;
  deadlineSeconds?: number;
}

function accept(rail: KnownRail, tamper: Tamper = {}): PaymentRequirements {
  const extra: CountersignExtra = {
    rail: "escrow",
    escrow: tamper.escrow ?? rail.escrow,
    chainId: rail.chainId,
    offerHash: tamper.offerHash ?? offerHash,
    deadlineSeconds: tamper.deadlineSeconds ?? offer.deadline,
    tokenName: rail.tokenName,
    tokenVersion: rail.tokenVersion,
  };
  return {
    scheme: "countersign",
    network: rail.network,
    amount: tamper.amount ?? offer.price,
    asset: tamper.token ?? rail.token,
    payTo: tamper.payTo ?? seller.address,
    maxTimeoutSeconds: offer.deadline,
    extra: extra as unknown as Record<string, unknown>,
  };
}

function fakeHub(rail: KnownRail, accepts: PaymentRequirements[]) {
  let signed = 0;
  const hub = {
    getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
    call: async (_hash: string, input: unknown, payment?: PaymentPayload) => {
      if (!payment) {
        return { kind: "required", required: { x402Version: 2, resource: { url: "x" }, accepts } };
      }
      signed++;
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
          payTo: p.terms.payee,
          asset: rail.token,
          amount: p.terms.amount,
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
  return { hub, signed: () => signed };
}

function buyOnce(f: ReturnType<typeof fresh>, args: { hub: HubClient; known?: KnownRail[]; envelope?: Envelope }) {
  return buy({
    hub: args.hub,
    offerHash,
    input: {},
    payers: [countersignPayer(buyer)],
    envelope: args.envelope ?? envelope(),
    journal: f.journal,
    state: f.state,
    now: NOW,
    known: args.known ?? [RAIL],
  });
}

describe("terms and pinned rails", () => {
  test("an unknown escrow is refused before signing", async () => {
    const f = fresh();
    const { hub, signed } = fakeHub(RAIL, [accept(RAIL, { escrow: thief.address })]);
    await expect(buyOnce(f, { hub })).rejects.toThrow("Refused. This rail is not one this agent knows.");
    expect(signed()).toBe(0);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
    expect(f.journal.entries()[0]?.reason).toBe("terms");
  });

  test("an unknown token is refused before signing", async () => {
    const f = fresh();
    const { hub, signed } = fakeHub(RAIL, [accept(RAIL, { token: thief.address })]);
    await expect(buyOnce(f, { hub })).rejects.toThrow("Refused. This rail is not one this agent knows.");
    expect(signed()).toBe(0);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
  });

  test("a known rail from rails.json is accepted", async () => {
    const f = fresh();
    const anvil: KnownRail = {
      ...RAIL,
      network: "eip155:31338",
      chainId: 31338,
      escrow: "0x7777777777777777777777777777777777777777",
      token: "0x8888888888888888888888888888888888888888",
      rpcUrl: "http://127.0.0.1:8545",
    };
    writeFileSync(f.state.railsPath, JSON.stringify([anvil]));
    const known = [...KNOWN_RAILS, ...f.state.loadRails()];
    const { hub, signed } = fakeHub(anvil, [accept(anvil)]);
    const res = await buyOnce(f, { hub, known });
    expect(res.output).toEqual({ a: "hi" });
    expect(signed()).toBe(1);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "signed", "released"]);
  });

  test("two concurrent buys under a one-call cap reserve once", async () => {
    const f = fresh();
    const { hub } = fakeHub(RAIL, [accept(RAIL)]);
    const tight = envelope({ cap: PRICE, perMerchant: PRICE });
    const results = await Promise.allSettled([buyOnce(f, { hub, envelope: tight }), buyOnce(f, { hub, envelope: tight })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const kinds = f.journal.entries().map((e) => e.kind);
    expect(kinds.filter((k) => k === "countersigned")).toHaveLength(1);
    expect(kinds.filter((k) => k === "signed")).toHaveLength(1);
    expect(kinds.filter((k) => k === "released")).toHaveLength(1);
    const refused = f.journal.entries().filter((e) => e.kind === "refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]?.reason).toBe("over-cap");
    expect(results.some((r) => r.status === "rejected" && r.reason instanceof BuyError)).toBe(true);
  });
});

describe("resume refunds", () => {
  const jobId = `0x${"22".repeat(32)}` as Hex;

  function signedJournal() {
    const f = fresh();
    const base = { at: 1, offerHash, seller: seller.address, amount: PRICE, network: RAIL.network, rail: "escrow" as const };
    f.journal.append({ ...base, kind: "countersigned", reservationId: "r1" });
    f.journal.append({ ...base, kind: "signed", reservationId: "r1", jobId });
    return f;
  }

  const hub = {
    job: async () => ({ jobId, offerHash, rail: "escrow", status: "refunded", deadline: 0, closeTx: "0xcc" }),
  } as unknown as HubClient;

  test("a hub refund without a chain refund appends nothing", async () => {
    const f = signedJournal();
    expect(f.journal.spend().total).toBe(PRICE);
    const out = await resume({ hub, journal: f.journal, state: f.state, now: 2, known: [RAIL], readJobStatus: async () => 2 });
    expect(out[0]?.status).toBe("hub says refunded; chain does not");
    expect(f.journal.entries().some((e) => e.kind === "refunded")).toBe(false);
    expect(f.journal.spend().total).toBe(PRICE);
  });

  test("a chain refund appends refunded", async () => {
    const f = signedJournal();
    const out = await resume({ hub, journal: f.journal, state: f.state, now: 2, known: [RAIL], readJobStatus: async () => 3 });
    expect(out[0]?.appended).toBe("refunded");
    expect(f.journal.entries().at(-1)?.kind).toBe("refunded");
    expect(f.journal.spend().total).toBe("0");
  });
});
