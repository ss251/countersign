import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { offerHash, type Offer, type PaymentPayload } from "@countersign/core";
import { WHITECHAIN_ESCROW, WHITECHAIN_RPC_URL, WHITECHAIN_USDT, whitechainRail } from "../src/whitechain/index.ts";

const seller = "0x1111111111111111111111111111111111111111";
const otherPayTo = "0x2222222222222222222222222222222222222222";
const JOB: Hex = `0x${"ab".repeat(32)}`;
const SIG: Hex = `0x${"cd".repeat(65)}`;

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
  bond: "0",
  rails: ["whitechain"],
  issuedAt: 1,
};

type Seen = { url: string; body: unknown };

function stub(reply: (url: string) => Response | Promise<Response> | Error) {
  const seen: Seen[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: JSON.parse(String(init?.body)) });
    const out = await reply(url);
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { fn, seen };
}

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const payment = { x402Version: 2, accepted: {}, payload: {} } as unknown as PaymentPayload;
const requirements = whitechainRail({ relayUrl: "http://relay" }).challenge(offer, { resource: "http://x", now: 0 });

describe("whitechain rail", () => {
  test("declaration", () => {
    expect(WHITECHAIN_RPC_URL).toBe("https://rpc.ankr.com/whitechain_testnet");
    const d = whitechainRail({ relayUrl: "http://relay" }).declaration;
    expect(d.id).toBe("whitechain");
    expect(d.network).toBe("eip155:1874");
    expect(d.scheme).toBe("countersign");
    expect(d.kind).toBe("escrow");
    expect(d.escrow).toBe(WHITECHAIN_ESCROW);
    expect(d.asset).toEqual({ network: "eip155:1874", address: WHITECHAIN_USDT, symbol: "USDT", decimals: 6 });
    expect(d.gasPaidBy).toBe("relayer");
    expect(d.explorerTx).toBe("https://explorer.testnet.whitechain.io/tx/{tx}");
  });

  test("challenge names the escrow and honours payTo.whitechain", () => {
    const rail = whitechainRail({ relayUrl: "http://relay" });
    const req = rail.challenge(offer, { resource: "http://x", now: 0 });
    expect(req.scheme).toBe("countersign");
    expect(req.network).toBe("eip155:1874");
    expect(req.amount).toBe("1500000");
    expect(req.asset).toBe(WHITECHAIN_USDT);
    expect(req.payTo).toBe(seller);
    expect(req.extra).toMatchObject({ rail: "whitechain", escrow: WHITECHAIN_ESCROW, chainId: 1874, offerHash: offerHash(offer) });
    const routed = rail.challenge({ ...offer, payTo: { whitechain: getAddress(otherPayTo) } }, { resource: "http://x", now: 0 });
    expect(routed.payTo).toBe(getAddress(otherPayTo));
  });

  test("verify and settle forward the bodies and return the relay's JSON", async () => {
    const s = stub((url) =>
      url.endsWith("/verify") ? json({ isValid: true, payer: seller }) : json({ success: true, transaction: "0xaa", network: "eip155:1874", jobId: JOB }),
    );
    const rail = whitechainRail({ relayUrl: "http://relay/", fetch: s.fn });
    expect(await rail.verify(payment, requirements)).toEqual({ isValid: true, payer: seller });
    expect(await rail.settle(payment, requirements)).toEqual({ success: true, transaction: "0xaa", network: "eip155:1874", jobId: JOB } as never);
    expect(s.seen.map((x) => x.url)).toEqual(["http://relay/verify", "http://relay/settle"]);
    expect(s.seen[0]!.body).toEqual({ x402Version: 2, paymentPayload: payment, paymentRequirements: requirements });
    expect(s.seen[1]!.body).toEqual(s.seen[0]!.body);
  });

  test("relay failures map to relay_unreachable", async () => {
    for (const reply of [() => new Error("down"), () => new Response("<html>", { status: 502 })]) {
      const rail = whitechainRail({ relayUrl: "http://relay", fetch: stub(reply).fn });
      expect(await rail.verify(payment, requirements)).toEqual({ isValid: false, invalidReason: "relay_unreachable" });
      expect(await rail.settle(payment, requirements)).toEqual({
        success: false,
        errorReason: "relay_unreachable",
        transaction: "",
        network: "eip155:1874",
      });
      expect((await rail.escrow!.cancel(JOB, SIG)).errorReason).toBe("relay_unreachable");
    }
  });

  test("escrow ops hit the right endpoints", async () => {
    const s = stub((url) =>
      url.endsWith("/escrow/refund") ? json({ ok: false, reason: "job_not_found" }) : json({ ok: true, transaction: "0xbb", url: "u", status: "x" }),
    );
    const rail = whitechainRail({ relayUrl: "http://relay", fetch: s.fn });
    const slip: Hex = `0x${"51".repeat(32)}`;
    expect(await rail.escrow!.release(JOB, slip, SIG)).toEqual({ success: true, transaction: "0xbb", network: "eip155:1874" });
    expect((await rail.escrow!.cancel(JOB, SIG)).success).toBe(true);
    expect(await rail.escrow!.refund(JOB)).toEqual({
      success: false,
      errorReason: "job_not_found",
      transaction: "",
      network: "eip155:1874",
    });
    expect(s.seen).toEqual([
      { url: "http://relay/escrow/release", body: { jobId: JOB, slipHash: slip, sellerSig: SIG } },
      { url: "http://relay/escrow/cancel", body: { jobId: JOB, sellerSig: SIG } },
      { url: "http://relay/escrow/refund", body: { jobId: JOB } },
    ]);
  });

  test("status reads the chain through the wrapped rail", async () => {
    const publicClient = { readContract: async () => ({ status: 1 }) } as never;
    const rail = whitechainRail({ relayUrl: "http://relay", publicClient });
    expect(await rail.escrow!.status(JOB)).toBe("funded");
  });
});
