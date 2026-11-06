import { describe, expect, test } from "bun:test";
import { USDT } from "../src/chain.ts";
import { signAuthorization } from "../src/eip3009.ts";
import type { RelayCall } from "../src/relayer.ts";
import { createTestRelay, makeAuthorization } from "./support.ts";

type TestRelay = ReturnType<typeof createTestRelay>;

async function transfer(relay: TestRelay, value = 1_000_000n): Promise<RelayCall> {
  const auth = makeAuthorization({
    from: relay.buyer.address,
    to: relay.merchant.address,
    value,
  });
  return {
    kind: "transferWithAuthorization",
    token: USDT.address,
    auth,
    signature: await signAuthorization(relay.buyer, auth),
  };
}

describe("relayer refusals", () => {
  test("not_allowed", async () => {
    const relay = createTestRelay();
    const call = await transfer(relay);
    const outcome = await relay.relayer.submit(
      { ...call, token: relay.buyer.address },
      relay.buyer.address,
    );
    expect(outcome).toEqual({ status: "refused", reason: "not_allowed" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("simulation_failed", async () => {
    const relay = createTestRelay();
    relay.chain.failSimulation = true;
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") expect(outcome.reason).toBe("simulation_failed");
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("fee_too_high", async () => {
    const relay = createTestRelay({ maxFeePerGas: 100_000_000_000n });
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome).toEqual({ status: "refused", reason: "fee_too_high" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("ceiling_wei", async () => {
    const relay = createTestRelay({ capWei: 0n });
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome).toEqual({ status: "refused", reason: "ceiling_wei" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("balance_floor", async () => {
    const relay = createTestRelay({ wbt: 0n, minBalanceWei: 1n });
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome).toEqual({ status: "refused", reason: "balance_floor" });
    expect(relay.chain.writes).toHaveLength(0);
  });
});

describe("relayer settlement", () => {
  test("confirmed path records the actual cost", async () => {
    const relay = createTestRelay();
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome.status).toBe("confirmed");
    if (outcome.status !== "confirmed") return;
    expect(outcome.gasUsed).toBe(90_000n);
    expect(outcome.costWei).toBe(90_000_000_000_000n);
    expect(relay.chain.writes).toHaveLength(1);
    expect(relay.ceiling.snapshot().usedWei).toBe(90_000_000_000_000n);
    expect(relay.ceiling.snapshot().txCount).toBe(1);
  });

  test("sends the gas limit with headroom, not the bare estimate", async () => {
    const relay = createTestRelay();
    await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(relay.chain.writes).toHaveLength(1);
    expect(relay.chain.writes[0]?.gas).toBe((relay.chain.gasEstimate * 120n) / 100n);
  });

  test("receipt timeout is pending and keeps the reservation", async () => {
    const relay = createTestRelay();
    relay.chain.timeoutReceipt = true;
    const outcome = await relay.relayer.submit(await transfer(relay), relay.buyer.address);
    expect(outcome.status).toBe("pending");
    expect(relay.chain.writes).toHaveLength(1);
    expect(relay.ceiling.snapshot().txCount).toBe(1);
  });

  test("concurrent submits run one at a time", async () => {
    const relay = createTestRelay();
    relay.chain.writeDelayMs = 5;
    const first = await transfer(relay);
    const second = await transfer(relay);
    const outcomes = await Promise.all([
      relay.relayer.submit(first, relay.buyer.address),
      relay.relayer.submit(second, relay.buyer.address),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["confirmed", "confirmed"]);
    expect(relay.chain.maxConcurrentWrites).toBe(1);
    expect(relay.chain.writes).toHaveLength(2);
  });
});
