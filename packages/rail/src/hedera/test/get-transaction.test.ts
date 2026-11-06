import { describe, expect, test } from "bun:test";
import { getTransaction } from "../mirror.ts";

const BASE = "http://mirror.test";
const TX_ID = "0.0.9185802@1793957000.000000001";

function record(result: string, over: Record<string, unknown> = {}) {
  return {
    transaction_id: "0.0.9185802-1793957000-000000001",
    result,
    name: "CRYPTOTRANSFER",
    consensus_timestamp: "1793957000.000000001",
    memo_base64: null,
    transfers: [],
    token_transfers: [],
    ...over,
  };
}

function mirror(transactions: object[]) {
  const fetch = (async () => Response.json({ transactions })) as unknown as typeof globalThis.fetch;
  return { base: BASE, fetch };
}

describe("getTransaction picks the real record", () => {
  test("a duplicate listed before the success returns the SUCCESS record", async () => {
    const tx = await getTransaction(TX_ID, mirror([record("DUPLICATE_TRANSACTION"), record("SUCCESS")]));
    expect(tx?.result).toBe("SUCCESS");
  });

  test("with no success record, the first failure is returned", async () => {
    const tx = await getTransaction(TX_ID, mirror([record("FAILED"), record("DUPLICATE_TRANSACTION")]));
    expect(tx?.result).toBe("FAILED");
  });
});
