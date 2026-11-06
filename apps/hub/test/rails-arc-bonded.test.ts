import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { railsFromEnv } from "../src/rails.ts";

const ARC_ESCROW_V2 = "0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE";

function arcEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ARC_ESCROW: ARC_ESCROW_V2,
    ARC_ESCROW_VERSION: "2",
    ARC_RPC_URL: "http://127.0.0.1:9",
    CS_RELAYER_KEY: generatePrivateKey(),
    ...extra,
  };
}

describe("bonded Arc jobs stay off until ARC_BONDED=1 (STEER-0300 C2)", () => {
  test("without ARC_BONDED the Arc rail names no funder, so the hub cannot fund a bonded job", async () => {
    const rails = await railsFromEnv(arcEnv(), {}, () => {});
    const arc = rails.find((rail) => rail.declaration.id === "escrow");
    expect(arc).toBeDefined();
    expect(arc?.funder).toBeUndefined();
  });

  test("ARC_BONDED=1 names the hub's submitter as the funder", async () => {
    const env = arcEnv({ ARC_BONDED: "1" });
    const rails = await railsFromEnv(env, {}, () => {});
    const arc = rails.find((rail) => rail.declaration.id === "escrow");
    expect(arc?.funder).toBe(privateKeyToAccount(env.CS_RELAYER_KEY as `0x${string}`).address);
  });
});
