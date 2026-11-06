/**
 * Offline tests of the rail helpers behind the production rail check. No hub, no chain.
 */

import { describe, expect, test } from "bun:test";
import { railOrderProblem, RETURN_MONEY_RAILS, undeclaredRails } from "../lib/rails.ts";

describe("undeclaredRails", () => {
  test("accepts the rails production declared before hedera was allowed", () => {
    expect(undeclaredRails(["escrow", "whitechain", "hedera-scheduled"])).toEqual([]);
  });

  test("accepts hedera as facilitator-paid only", () => {
    expect(undeclaredRails(["escrow", "hedera"])).toEqual([]);
  });

  test("names every rail outside the list", () => {
    expect(undeclaredRails(["escrow", "gateway", "x402-direct"])).toEqual(["gateway", "x402-direct"]);
  });

  test("does not mistake an inherited property for a declared rail", () => {
    expect(undeclaredRails(["toString", "constructor"])).toEqual(["toString", "constructor"]);
  });
});

describe("RETURN_MONEY_RAILS", () => {
  test("labels hedera as facilitator-paid only", () => {
    expect(RETURN_MONEY_RAILS.hedera).toContain("facilitator-paid only");
  });

  test("holds exactly four rails, no wider", () => {
    expect(Object.keys(RETURN_MONEY_RAILS).sort()).toEqual(["escrow", "hedera", "hedera-scheduled", "whitechain"]);
  });
});

describe("railOrderProblem", () => {
  test("accepts production's order on c6f3a21", () => {
    expect(railOrderProblem(["escrow", "whitechain", "hedera-scheduled", "hedera"])).toBeNull();
  });

  test("accepts a declaration without hedera", () => {
    expect(railOrderProblem(["escrow", "whitechain", "hedera-scheduled"])).toBeNull();
  });

  test("rejects hedera listed before hedera-scheduled", () => {
    expect(railOrderProblem(["escrow", "hedera", "hedera-scheduled"])).toContain("before");
  });

  test("rejects hedera declared without hedera-scheduled", () => {
    expect(railOrderProblem(["escrow", "hedera"])).toContain("without hedera-scheduled");
  });
});
