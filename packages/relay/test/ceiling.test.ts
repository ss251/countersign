import { describe, expect, test } from "bun:test";
import { SpendCeiling } from "../src/ceiling.ts";

const payer = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

describe("spend ceiling", () => {
  test("refuses a reservation past the wei cap", () => {
    const ceiling = new SpendCeiling({
      windowMs: 1000,
      capWei: 1000n,
      maxTx: 100,
      maxTxPerPayer: 100,
    });
    expect(ceiling.reserve({ payer, worstCaseWei: 600n }).ok).toBe(true);
    expect(ceiling.reserve({ payer, worstCaseWei: 500n })).toEqual({
      ok: false,
      reason: "ceiling_wei",
    });
  });

  test("frees capacity when the window rolls", () => {
    let clock = 1000;
    const ceiling = new SpendCeiling(
      { windowMs: 1000, capWei: 1000n, maxTx: 100, maxTxPerPayer: 100 },
      () => clock,
    );
    expect(ceiling.reserve({ payer, worstCaseWei: 800n }).ok).toBe(true);
    expect(ceiling.reserve({ payer, worstCaseWei: 800n }).ok).toBe(false);
    clock += 1001;
    expect(ceiling.reserve({ payer, worstCaseWei: 800n }).ok).toBe(true);
  });

  test("enforces the per-payer transaction limit", () => {
    const ceiling = new SpendCeiling({
      windowMs: 1000,
      capWei: 1000n,
      maxTx: 100,
      maxTxPerPayer: 2,
    });
    expect(ceiling.reserve({ payer, worstCaseWei: 1n }).ok).toBe(true);
    expect(ceiling.reserve({ payer, worstCaseWei: 1n }).ok).toBe(true);
    expect(ceiling.reserve({ payer, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_payer",
    });
    expect(ceiling.reserve({ payer: other, worstCaseWei: 1n }).ok).toBe(true);
  });

  test("enforces the transaction limit", () => {
    const ceiling = new SpendCeiling({
      windowMs: 1000,
      capWei: 1000n,
      maxTx: 2,
      maxTxPerPayer: 100,
    });
    expect(ceiling.reserve({ payer, worstCaseWei: 1n }).ok).toBe(true);
    expect(ceiling.reserve({ payer: other, worstCaseWei: 1n }).ok).toBe(true);
    expect(ceiling.reserve({ payer: other, worstCaseWei: 1n })).toEqual({
      ok: false,
      reason: "ceiling_tx",
    });
  });

  test("cancel frees capacity and settle records the actual cost", () => {
    const ceiling = new SpendCeiling({
      windowMs: 1000,
      capWei: 1000n,
      maxTx: 100,
      maxTxPerPayer: 100,
    });
    const first = ceiling.reserve({ payer, worstCaseWei: 600n });
    if (!first.ok) throw new Error("expected a reservation");
    expect(ceiling.snapshot().usedWei).toBe(600n);
    ceiling.cancel(first.ticket);
    expect(ceiling.snapshot().usedWei).toBe(0n);
    expect(ceiling.snapshot().txCount).toBe(0);

    const second = ceiling.reserve({ payer, worstCaseWei: 600n });
    if (!second.ok) throw new Error("expected a reservation");
    ceiling.settle(second.ticket, 100n);
    expect(ceiling.snapshot().usedWei).toBe(100n);
    expect(ceiling.snapshot().remainingWei).toBe(900n);
  });
});
