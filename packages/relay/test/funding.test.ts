import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { createRelayApp } from "../src/server.ts";
import type { ChainReader, ContractCall } from "../src/ports.ts";
import { NOW, createTestRelay } from "./support.ts";

const FEE_SPLIT = getAddress("0x3333333333333333333333333333333333333333");
const OTHER_PAYEE = getAddress("0x4444444444444444444444444444444444444444");

function appWith(readContract: (call: ContractCall) => Promise<unknown>) {
  const relay = createTestRelay();
  const app = createRelayApp({
    reader: { readContract } as unknown as ChainReader,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: {},
  });
  return { relay, app };
}

describe("/status funding", () => {
  test("names the FeeSplit, its payees and the relayer's share", async () => {
    let balanceReads = 0;
    const { relay, app } = appWith(async (call) => {
      if (call.functionName === "treasury") return FEE_SPLIT;
      if (call.functionName === "payees") {
        return [
          [relay.relayer.address, OTHER_PAYEE],
          [7000, 3000],
        ];
      }
      if (call.functionName === "tollBps") return 100;
      if (call.functionName === "balanceOf") {
        balanceReads += 1;
        return 123_456n;
      }
      throw new Error(`unexpected read: ${call.functionName}`);
    });

    const body = (await (await app.request("/status")).json()) as {
      funding: unknown;
    };
    expect(body.funding).toEqual({
      feeSplit: FEE_SPLIT,
      payees: [
        { address: relay.relayer.address, shareBps: 7000 },
        { address: OTHER_PAYEE, shareBps: 3000 },
      ],
      relayerShareBps: 7000,
      tollBps: 100,
      feeSplitUsdt: "123456",
    });

    await app.request("/status");
    expect(balanceReads).toBe(1);
  });

  test("a relayer that is not a payee has a zero share", async () => {
    const { app } = appWith(async (call) => {
      if (call.functionName === "treasury") return FEE_SPLIT;
      if (call.functionName === "payees") return [[OTHER_PAYEE], [10_000]];
      if (call.functionName === "tollBps") return 100;
      if (call.functionName === "balanceOf") return 0n;
      throw new Error(`unexpected read: ${call.functionName}`);
    });

    const body = (await (await app.request("/status")).json()) as {
      funding: { relayerShareBps: number; feeSplitUsdt: string };
    };
    expect(body.funding.relayerShareBps).toBe(0);
    expect(body.funding.feeSplitUsdt).toBe("0");
  });

  test("a failed startup read leaves funding null and the relay serving", async () => {
    const { relay, app } = appWith(async (call) => {
      throw new Error(`read failed: ${call.functionName}`);
    });

    const response = await app.request("/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { address: string; funding: unknown };
    expect(body.address).toBe(relay.relayer.address);
    expect(body.funding).toBeNull();
  });
});
