import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { USDT } from "../src/chain.ts";
import { createRelayApp } from "../src/server.ts";
import type { ChainReader, ContractCall } from "../src/ports.ts";
import { NOW, createTestRelay } from "./support.ts";

const FEE_SPLIT = getAddress("0x3333333333333333333333333333333333333333");

describe("/status feeSplitUsdt", () => {
  test("reads the FeeSplit's USDT balance from the token", async () => {
    const relay = createTestRelay();
    let balanceReads = 0;
    const reader = {
      readContract: async (call: ContractCall) => {
        if (call.functionName === "treasury") return FEE_SPLIT;
        if (call.functionName === "payees") return [[relay.relayer.address], [10_000]];
        if (call.functionName === "tollBps") return 100;
        if (call.functionName === "balanceOf") {
          const owner = call.args?.[0];
          if (
            getAddress(call.address) === USDT.address &&
            typeof owner === "string" &&
            getAddress(owner) === FEE_SPLIT
          ) {
            balanceReads += 1;
            return 987_654n;
          }
          throw new Error(`balanceOf read at ${call.address}`);
        }
        throw new Error(`unexpected read: ${call.functionName}`);
      },
    } as unknown as ChainReader;
    const app = createRelayApp({
      reader,
      relayer: relay.relayer,
      ledger: relay.ledger,
      now: () => NOW,
      config: {},
    });

    const body = (await (await app.request("/status")).json()) as {
      funding: { feeSplitUsdt: string };
    };
    expect(body.funding.feeSplitUsdt).toBe("987654");
    expect(balanceReads).toBe(1);
  });
});
