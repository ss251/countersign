import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { whitechainRail } from "../src/whitechain/index.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const JOB: Hex = `0x${"11".repeat(32)}`;
const SLIP: Hex = `0x${"22".repeat(32)}`;
const SIG: Hex = `0x${"33".repeat(65)}`;

function recorder() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return Response.json({ ok: true, transaction: `0x${"ab".repeat(32)}`, url: "x", status: "released" });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("the whitechain rail's release carries the hub token on v2", () => {
  test("v2 with a relay token posts /escrow/release with the hub bearer", async () => {
    const { calls, fetch } = recorder();
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, relayToken: "a-hub-token-long-enough", fetch });
    expect((await rail.escrow!.release(JOB, SLIP, SIG)).success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://relay/escrow/release");
    expect(calls[0]!.headers.authorization).toBe("Bearer a-hub-token-long-enough");
  });

  test("v2 without a token and v1 send no authorization header", async () => {
    for (const opts of [
      { relayUrl: "http://relay", version: 2 as const, escrow: V2 },
      { relayUrl: "http://relay", relayToken: "a-hub-token-long-enough" },
    ]) {
      const { calls, fetch } = recorder();
      const rail = whitechainRail({ ...opts, fetch });
      await rail.escrow!.release(JOB, SLIP, SIG);
      expect(calls[0]!.headers.authorization).toBeUndefined();
    }
  });
});
