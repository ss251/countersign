import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { type Offer, offerHash } from "@countersign/core";
import { WHITECHAIN_ESCROW, WHITECHAIN_USDT, whitechainRail } from "../src/whitechain/index.ts";

const seller = "0x1111111111111111111111111111111111111111";
const V2 = getAddress("0x7777777777777777777777777777777777777777");
const JOB: Hex = `0x${"ab".repeat(32)}`;
const SIG: Hex = `0x${"cd".repeat(65)}`;
const TOKEN = "a-hub-token-long-enough";

const offer: Offer = {
  v: 1,
  seller,
  title: "t",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1500000",
  deadline: 120,
  bond: "500000",
  reviewWindow: 300,
  rails: ["whitechain"],
  issuedAt: 1,
};

type Seen = { url: string; body: unknown; headers: Record<string, string> };

function stub() {
  const seen: Seen[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ ok: true, transaction: "0xbb", url: "u", status: "x" }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fn, seen };
}

describe("whitechain rail v2", () => {
  test("version 2 needs its escrow address", () => {
    expect(() => whitechainRail({ relayUrl: "http://relay", version: 2 })).toThrow(
      "whitechain escrow v2 needs its escrow address",
    );
  });

  test("the challenge names the v2 escrow, the bond and the window", () => {
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
    const req = rail.challenge(offer, { resource: "http://x", now: 0 });
    expect(req.extra).toMatchObject({
      rail: "whitechain",
      escrow: V2,
      chainId: 1874,
      offerHash: offerHash(offer),
      bond: "500000",
      reviewWindow: 300,
      escrowVersion: 2,
    });
    expect(rail.declaration.escrow).toBe(V2);
  });

  test("the v2 ops call the right routes with the right bodies", async () => {
    const s = stub();
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, fetch: s.fn, relayToken: TOKEN });
    const ops = rail.escrow!;
    expect((await ops.accept!(JOB, SIG)).success).toBe(true);
    expect((await ops.dispute!(JOB, 5, SIG)).success).toBe(true);
    expect((await ops.releaseAfterWindow!(JOB)).success).toBe(true);
    expect((await ops.failDelivery!(JOB)).success).toBe(true);
    expect(s.seen).toEqual([
      { url: "http://relay/escrow/accept", body: { jobId: JOB, buyerSig: SIG }, headers: { "content-type": "application/json" } },
      { url: "http://relay/escrow/dispute", body: { jobId: JOB, status: 5, buyerSig: SIG }, headers: { "content-type": "application/json" } },
      { url: "http://relay/escrow/release-after-window", body: { jobId: JOB }, headers: { "content-type": "application/json" } },
      {
        url: "http://relay/escrow/fail",
        body: { jobId: JOB },
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      },
    ]);
  });

  test("failDelivery is absent without a relay token", () => {
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
    expect(rail.escrow!.failDelivery).toBeUndefined();
    expect(rail.escrow!.accept).toBeDefined();
    expect(rail.escrow!.dispute).toBeDefined();
    expect(rail.escrow!.releaseAfterWindow).toBeDefined();
  });

  test("the base rail supplies reviewOf, tollBps and the 600-second window", async () => {
    const publicClient = {
      readContract: async (input: { functionName: string }) =>
        input.functionName === "reviewOf"
          ? [300n, 1_000n, 1_300n]
          : input.functionName === "tollBps"
            ? 100n
            : { status: 1 },
    } as never;
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, publicClient });
    expect(await rail.escrow!.reviewOf!(JOB)).toEqual({ window: 300, deliveredAt: 1_000, endsAt: 1_300 });
    expect(await rail.escrow!.tollBps!()).toBe(100);
    expect(rail.escrow!.disputeWindowSeconds).toBe(600);
    expect(await rail.escrow!.status(JOB)).toBe("funded");
  });

  test("version 1 is unchanged: default escrow, no v2 methods, window 0", () => {
    const rail = whitechainRail({ relayUrl: "http://relay" });
    expect(rail.declaration.escrow).toBe(WHITECHAIN_ESCROW);
    expect(rail.declaration.asset.address).toBe(WHITECHAIN_USDT);
    expect(rail.escrow!.accept).toBeUndefined();
    expect(rail.escrow!.dispute).toBeUndefined();
    expect(rail.escrow!.releaseAfterWindow).toBeUndefined();
    expect(rail.escrow!.failDelivery).toBeUndefined();
    expect(rail.escrow!.reviewOf).toBeUndefined();
    expect(rail.escrow!.disputeWindowSeconds).toBeUndefined();
    const req = rail.challenge({ ...offer, bond: "0", reviewWindow: undefined }, { resource: "x", now: 0 });
    expect(req.extra).toMatchObject({ escrow: WHITECHAIN_ESCROW, bond: "0" });
    expect(req.extra).not.toHaveProperty("reviewWindow");
    expect(req.extra).not.toHaveProperty("escrowVersion");
  });
});
