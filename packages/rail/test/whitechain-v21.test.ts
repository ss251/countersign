import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import { whitechainRail } from "../src/whitechain/index.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const JOB: Hex = `0x${"ab".repeat(32)}`;
const SIG: Hex = `0x${"cd".repeat(65)}`;
const LOCK: Hex = `0x${"56".repeat(65)}`;

const payment = { x402Version: 2, accepted: {}, payload: {} } as unknown as PaymentPayload;
const requirements = { scheme: "countersign" } as unknown as PaymentRequirements;

type Seen = { url: string; body: Record<string, unknown> };

function stub() {
  const seen: Seen[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({ ok: true, transaction: "0xaa", url: "u", status: "x", success: true, network: "eip155:1874" }),
      { headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fn, seen };
}

describe("whitechain rail v2.1", () => {
  test("settle posts lockSig when given and omits it otherwise", async () => {
    const s = stub();
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, fetch: s.fn });

    expect((await rail.settle(payment, requirements, { lockSig: LOCK })).success).toBe(true);
    expect((await rail.settle(payment, requirements)).success).toBe(true);

    expect(s.seen).toEqual([
      {
        url: "http://relay/settle",
        body: { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements, lockSig: LOCK },
      },
      {
        url: "http://relay/settle",
        body: { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements },
      },
    ]);
  });

  test("dispute posts the status the buyer signed", async () => {
    const s = stub();
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, fetch: s.fn });

    expect((await rail.escrow!.dispute!(JOB, 5, SIG)).success).toBe(true);

    expect(s.seen).toEqual([
      {
        url: "http://relay/escrow/dispute",
        body: { jobId: JOB, status: 5, buyerSig: SIG },
      },
    ]);
  });
});
