import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { canonicalHash, type CountersignExtra, type Envelope, type Offer } from "@countersign/core";
import { Journal, State, buy, countersignPayer } from "../src/index.ts";
import type { HubClient, KnownRail } from "../src/index.ts";

// cs-w1 adversarial tests. A failing test here is a blocker.
// The buyer signs whatever the hub's 402 says. A hostile or compromised hub must not be able to
// redirect the signature: the buyer's own view of the offer is the offer it fetched and hashed.

const seller = privateKeyToAccount(generatePrivateKey());
const thief = privateKeyToAccount(generatePrivateKey());
const buyerAcct = privateKeyToAccount(generatePrivateKey());
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const rail: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "https://rpc.testnet.arc.network",
};
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
const envelope: Envelope = { cap: "10000000", perMerchant: "10000000", allowlist: [seller.address] } as Envelope;

async function attempt(tamper: { payTo?: Address; amount?: string; offerHash?: `0x${string}`; deadlineSeconds?: number; escrow?: Address }) {
  const extra: CountersignExtra = {
    rail: "escrow",
    escrow: tamper.escrow ?? ESCROW,
    chainId: 5042002,
    offerHash: tamper.offerHash ?? offerHash,
    deadlineSeconds: tamper.deadlineSeconds ?? 120,
    tokenName: "USDC",
    tokenVersion: "2",
  };
  const accepts = [
    {
      scheme: "countersign",
      network: "eip155:5042002",
      amount: tamper.amount ?? PRICE,
      asset: TOKEN,
      payTo: tamper.payTo ?? seller.address,
      maxTimeoutSeconds: 120,
      extra,
    },
  ];
  let signed = false;
  const hub = {
    getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
    call: async (_h: unknown, _i: unknown, payment?: unknown) => {
      if (payment) {
        signed = true;
        return { kind: "error", status: 500, code: "x", message: "stop" };
      }
      return { kind: "required", required: { x402Version: 2, resource: { url: "x" }, accepts } };
    },
  } as unknown as HubClient;
  const dir = mkdtempSync(join(tmpdir(), "w1-"));
  const journal = new Journal(join(dir, "journal.jsonl"));
  await buy({
    hub,
    offerHash,
    input: {},
    payers: [countersignPayer(buyerAcct)],
    envelope,
    journal,
    state: new State(dir),
    now: 1_762_400_000,
    approve: true,
    known: [rail],
  }).catch(() => undefined);
  return { signed, countersigned: journal.entries().some((e) => e.kind === "countersigned") };
}

describe("W1 B4: the buyer signs terms the hub chose", () => {
  test("honest terms are signed", async () => {
    expect((await attempt({})).signed).toBe(true);
  });
  test("a payTo that is not the offer's seller is refused before signing", async () => {
    const r = await attempt({ payTo: thief.address });
    expect(r.signed).toBe(false);
    expect(r.countersigned).toBe(false);
  });
  test("an amount other than the offer's price is refused before signing", async () => {
    const r = await attempt({ amount: "9000000" });
    expect(r.signed).toBe(false);
    expect(r.countersigned).toBe(false);
  });
  test("an offerHash other than the one requested is refused before signing", async () => {
    const r = await attempt({ offerHash: `0x${"11".repeat(32)}` });
    expect(r.signed).toBe(false);
    expect(r.countersigned).toBe(false);
  });
  test("a delivery window far longer than the offer's is refused before signing", async () => {
    const r = await attempt({ deadlineSeconds: 10_000_000 });
    expect(r.signed).toBe(false);
    expect(r.countersigned).toBe(false);
  });
});

describe("W1 B6: the fetched offer is not bound to the hash that was requested", () => {
  test("an offer whose hash is not the requested offerHash is refused before signing", async () => {
    // The envelope may allowlist an offerHash. A hub that answers GET /offers/<hash> with a
    // different offer (other payee, other price) would pass every terms check against its own lie.
    const lie: Offer = { ...offer, seller: thief.address, price: "9000000" };
    const extra: CountersignExtra = {
      rail: "escrow",
      escrow: ESCROW,
      chainId: 5042002,
      offerHash,
      deadlineSeconds: 120,
      tokenName: "USDC",
      tokenVersion: "2",
    };
    const accepts = [
      { scheme: "countersign", network: "eip155:5042002", amount: lie.price, asset: TOKEN, payTo: thief.address, maxTimeoutSeconds: 120, extra },
    ];
    let signed = false;
    const hub = {
      getOffer: async () => ({ offerHash, offer: lie, online: true, status: "listed" }),
      call: async (_h: unknown, _i: unknown, payment?: unknown) => {
        if (payment) {
          signed = true;
          return { kind: "error", status: 500, code: "x", message: "stop" };
        }
        return { kind: "required", required: { x402Version: 2, resource: { url: "x" }, accepts } };
      },
    } as unknown as HubClient;
    const dir = mkdtempSync(join(tmpdir(), "w1-"));
    await buy({
      hub,
      offerHash,
      input: {},
      payers: [countersignPayer(buyerAcct)],
      envelope: { cap: "100000000", perMerchant: "100000000", allowlist: [offerHash] } as Envelope,
      journal: new Journal(join(dir, "journal.jsonl")),
      state: new State(dir),
      now: 1_762_400_000,
      approve: true,
      known: [rail],
    }).catch(() => undefined);
    expect(signed).toBe(false);
  });
});
