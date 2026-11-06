import { describe, expect, test } from "bun:test";
import { slipHash, type Slip } from "@countersign/core";
import live from "./fixtures/live-arc-slip.json";
import { verifySlip } from "../src/lib/verify.ts";

/**
 * Reads Arc testnet's public RPC, so it runs only with CS_LIVE=1. The slip is the one the
 * cold spine released on Arc testnet (escrow 0x44d1…f54a, block 71009900).
 */
const run = process.env.CS_LIVE === "1" ? describe : describe.skip;
const slip = live as unknown as Slip;

run("the fifth check on Arc testnet", () => {
  test("the chain holds this slip's hash", async () => {
    const v = await verifySlip(slip, { readChain: true });
    const onchain = v.checks.find((c) => c.id === "onchain");
    expect(onchain?.state).toBe("pass");
    expect(onchain?.title).toBe("The chain holds this slip's hash");
    expect(onchain?.detail).toContain("block 71,009,900");
    expect(v.valid).toBe(true);
  }, 20_000);

  test("a tampered body whose own hash still matches fails on chain", async () => {
    const t = structuredClone(slip);
    t.body.amount = "20000";
    t.hash = slipHash(t.body);
    const v = await verifySlip(t, { readChain: true });
    expect(v.checks.find((c) => c.id === "hash")?.state).toBe("pass");
    expect(v.checks.find((c) => c.id === "onchain")?.state).toBe("fail");
    expect(v.valid).toBe(false);
  }, 20_000);

  test("a tampered body keeping the claimed hash fails on chain as a different hash", async () => {
    const t = structuredClone(slip);
    t.body.amount = "20000";
    const v = await verifySlip(t, { readChain: true });
    const onchain = v.checks.find((c) => c.id === "onchain");
    expect(onchain?.state).toBe("fail");
    expect(onchain?.title).toBe("The chain holds a different hash");
  }, 20_000);
});
