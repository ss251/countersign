import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { PAYMENT_SIGNATURE_HEADER, canonicalHash, type CountersignExtra, type EnsResolve, type Offer } from "@countersign/core";
import { BuyError, HubClient, Journal, State, buy, countersignPayer } from "../src/index.ts";
import type { KnownRail } from "../src/index.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const buyerAcct = privateKeyToAccount(generatePrivateKey());
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const RAIL: KnownRail = {
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
  summary: "echoes",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1000",
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  ens: "alice.eth",
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);
const extra: CountersignExtra = {
  rail: "escrow",
  escrow: ESCROW,
  chainId: 5042002,
  offerHash,
  deadlineSeconds: 120,
  tokenName: "USDC",
  tokenVersion: "2",
};

let unpaid = 0;
let paid = 0;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `/offers/${offerHash}`) {
      return Response.json({ offerHash, offer, online: true, status: "listed" });
    }
    if (req.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      if (!req.headers.get(PAYMENT_SIGNATURE_HEADER)) {
        unpaid++;
        const accepts = [{ scheme: "countersign", network: RAIL.network, amount: "1000", asset: TOKEN, payTo: seller.address, maxTimeoutSeconds: 120, extra }];
        return Response.json({ x402Version: 2, resource: { url: req.url }, accepts }, { status: 402 });
      }
      paid++;
      return Response.json({ code: "stop-here", message: "Signed and sent; the test stops here." }, { status: 400 });
    }
    return new Response("{}", { status: 404 });
  },
});
afterAll(() => server.stop(true));

async function attempt(ens: EnsResolve | undefined) {
  const state = new State(mkdtempSync(join(tmpdir(), "cs-buyer-ens-")));
  const journal = new Journal(state.journalPath);
  unpaid = 0;
  paid = 0;
  let error: unknown;
  try {
    await buy({
      hub: new HubClient(`http://127.0.0.1:${server.port}`),
      offerHash,
      input: {},
      payers: [countersignPayer(buyerAcct)],
      envelope: { v: 1, agent: buyerAcct.address, cap: "5000000", perMerchant: "5000000", allowlist: [], revoked: false },
      journal,
      state,
      now: Math.floor(Date.now() / 1000),
      known: [RAIL],
      ...(ens ? { ens } : {}),
    });
  } catch (e) {
    error = e;
  }
  return { error, journal };
}

describe("buy from a seller named on ENS", () => {
  test("pays when the buyer's own lookup resolves the name to the seller", async () => {
    const { error } = await attempt(async () => seller.address);
    expect((error as Error).message).toBe("Signed and sent; the test stops here.");
    expect(paid).toBe(1);
  });

  test("refuses before asking for terms when the name resolves to someone else", async () => {
    const { error, journal } = await attempt(async () => stranger.address);
    expect(error).toBeInstanceOf(BuyError);
    expect((error as Error).message).toContain("not to the offer's seller");
    expect(unpaid + paid).toBe(0);
    expect(journal.entries().map((e) => [e.kind, e.reason])).toEqual([["refused", "ens-mismatch"]]);
  });

  test("refuses an unresolved name, a failed lookup and a missing resolver, signing nothing", async () => {
    const down: EnsResolve = async () => {
      throw new Error("rpc down");
    };
    for (const [resolver, reason] of [
      [async () => null, "ens-unresolved"],
      [down, "ens-unavailable"],
      [undefined, "ens-unavailable"],
    ] as const) {
      const { error, journal } = await attempt(resolver);
      expect(error).toBeInstanceOf(BuyError);
      expect(paid).toBe(0);
      expect(journal.entries().at(-1)?.reason).toBe(reason);
    }
  });
});
