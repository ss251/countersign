import { describe, expect, test } from "bun:test";
import * as fx from "../src/fixtures/index.ts";
import { failedReason } from "../src/lib/api.ts";
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
