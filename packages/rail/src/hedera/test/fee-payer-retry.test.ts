import { describe, expect, test } from "bun:test";
import { feePayerWithRetry, type Facilitator } from "../facilitator.ts";

function stub(answer: (call: number) => string | null): {
  facilitator: Pick<Facilitator, "feePayer">;
  calls: () => number;
} {
  let calls = 0;
  return {
    facilitator: {
      async feePayer() {
        const call = calls++;
        return answer(call);
      },
    },
    calls: () => calls,
  };
}

function recorder(): { sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  const sleeps: number[] = [];
  return {
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    sleeps,
  };
}

describe("feePayerWithRetry", () => {
  test("a facilitator that throws twice then answers is trusted after three attempts", async () => {
    const f = stub((call) => {
      if (call < 2) throw new Error("connection reset");
      return "0.0.9185802";
    });
    const { sleep, sleeps } = recorder();

    const result = await feePayerWithRetry(f.facilitator, { sleep });

    expect(result.feePayer).toBe("0.0.9185802");
    expect(f.calls()).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  test("a facilitator that never answers returns null and the last error", async () => {
    const f = stub(() => {
      throw new Error("facilitator down");
    });
    const { sleep } = recorder();

    const result = await feePayerWithRetry(f.facilitator, { sleep });

    expect(result.feePayer).toBeNull();
    expect(result.error).toBe("facilitator down");
    expect(f.calls()).toBe(3);
  });

  test("a facilitator that answers at once is asked once", async () => {
    const f = stub(() => "0.0.9185802");
    const { sleep, sleeps } = recorder();

    const result = await feePayerWithRetry(f.facilitator, { sleep });

    expect(result.feePayer).toBe("0.0.9185802");
    expect(f.calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });
});
