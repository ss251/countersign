import { describe, expect, test } from "bun:test";
import type { Rail } from "@countersign/rail";
import { assertBootable, BootRefused, mainnetProblems } from "../src/network.ts";
import { railsFromEnv } from "../src/rails.ts";

function fakeRail(id: string): Rail {
  return { declaration: { id } } as unknown as Rail;
}

describe("the held Hedera rail", () => {
  test("HEDERA_SCHEDULED_RAIL starts hedera-scheduled on testnet, and mainnet refuses it", async () => {
    const env = { HEDERA_SCHEDULED_RAIL: "1" };
    const rails = await railsFromEnv(env, {
      hederaScheduled: async () => fakeRail("hedera-scheduled"),
    });
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["hedera-scheduled"]);

    const problems = mainnetProblems({ CS_NETWORK: "mainnet", ...env });
    expect(problems).toEqual([expect.stringContaining("Rail hedera-scheduled has no mainnet")]);
    expect(() => assertBootable({ CS_NETWORK: "mainnet", ...env })).toThrow(BootRefused);
  });
});
