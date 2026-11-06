import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import { failedReason } from "../src/lib/api.ts";
import { envelopeChecklist } from "../src/lib/checklist.ts";
import type { EnvelopeView } from "../src/lib/types.ts";
import type { Approval } from "../src/lib/types.ts";
import { mergeApprovals } from "../src/routes/buyer/queue.ts";

const base = fx.approvals[0]!;
const req = (id: string): Approval => ({ ...base, id, agent: "0x00000000000000000000000000000000000000a1" });
const ids = (list: Approval[]) => list.map((a) => a.id);
const none = new Set<string>();

describe("buyer phone: approvals from the hub", () => {
  test("a new request queues behind the one on screen", () => {
    const merged = mergeApprovals([req("a")], [req("b"), req("a")], none, none);
    expect(ids(merged)).toEqual(["a", "b"]);
  });

  test("a countersigned request stays while its job runs, even after the hub stops listing it", () => {
    const merged = mergeApprovals([req("a"), req("b")], [req("c")], new Set(["a"]), none);
    expect(ids(merged)).toEqual(["a", "c"]);
  });

  test("a request closed on this phone never returns from a poll that raced the decision", () => {
    const merged = mergeApprovals([req("b")], [req("a"), req("b")], none, new Set(["a"]));
    expect(ids(merged)).toEqual(["b"]);
  });

  test("a request the hub no longer lists leaves unless this phone is following it", () => {
    expect(ids(mergeApprovals([req("a")], [req("b")], none, none))).toEqual(["b"]);
    expect(ids(mergeApprovals([req("a")], [], none, none))).toEqual([]);
  });

  test("the first poll takes the hub's order as it is", () => {
    expect(ids(mergeApprovals([], [req("c"), req("b"), req("a")], none, none))).toEqual(["c", "b", "a"]);
  });
});

describe("buyer phone: a failed delivery says where the money is", () => {
  test("escrow rails return it at the deadline", () => {
    for (const rail of ["escrow", "whitechain", "erc8183"] as const) expect(failedReason(rail)).toContain("returns to your agent at the deadline");
  });

  test("rails that settle before delivery do not claim a refund", () => {
    for (const rail of ["eip3009", "gateway", "hedera", "mpp"] as const) {
      expect(failedReason(rail)).toContain("not returned automatically");
      expect(failedReason(rail)).not.toContain("returns to your agent");
    }
  });
});

describe("envelope checklist: the rules a person reads, same as core", () => {
  const seller = "0x00000000000000000000000000000000000000b2";
  const view = (patch: Partial<EnvelopeView["envelope"]> = {}, askAbove: string | null = "50000"): EnvelopeView => ({
    ...structuredClone(fx.envelope),
    askAbove,
    spent: { total: "0", bySeller: {} } as EnvelopeView["spent"],
    envelope: { ...structuredClone(fx.envelope.envelope), cap: "1000000", perMerchant: "100000", allowlist: [], revoked: false, ...patch },
  });
  const call = (amount: string) => ({ seller, offerHash: "0xabc", amount, sellerName: "tools" });

  test("inside every limit and above the ask threshold: three ticks and the dot that needs you", () => {
    const kinds = envelopeChecklist(view(), call("60000")).map((c) => c.kind);
    expect(kinds).toEqual(["pass", "pass", "pass", "ask"]);
  });

  test("under the ask threshold the agent buys alone, and says so", () => {
    const last = envelopeChecklist(view(), call("10000")).at(-1)!;
    expect(last.kind).toBe("pass");
    expect(last.text).toContain("buys it alone");
  });

  test("an envelope that never asks says so instead of inventing a threshold", () => {
    const last = envelopeChecklist(view({}, null), call("10000")).at(-1)!;
    expect(last.text).toBe("No ask threshold, so the agent buys it alone");
  });

  test("a seller missing from a non-empty allowlist is a red cross, not a pass", () => {
    const checks = envelopeChecklist(view({ allowlist: ["0x00000000000000000000000000000000000000c3"] }), call("10000"));
    expect(checks.find((c) => c.text.includes("allowlist"))).toEqual({ kind: "fail", text: "Seller not on the allowlist" });
  });

  test("over the per-seller cap fails even when the budget has room", () => {
    const checks = envelopeChecklist(view(), call("150000"));
    expect(checks[0]!.kind).toBe("pass");
    expect(checks[1]!.kind).toBe("fail");
  });
});
