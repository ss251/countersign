import { describe, expect, test } from "bun:test";
import type { Rail } from "@countersign/rail";
import { railsFromEnv } from "../src/rails.ts";

function fakeRail(id: string): Rail {
  return { declaration: { id } } as unknown as Rail;
}

describe("the Hedera rails order", () => {
  test("hedera-scheduled is declared before hedera when both are on", async () => {
    const rails = await railsFromEnv(
      { HEDERA_RAIL: "1", HEDERA_SCHEDULED_RAIL: "1" },
      {
        hedera: async () => fakeRail("hedera"),
        hederaScheduled: async () => fakeRail("hedera-scheduled"),
      },
    );
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["hedera-scheduled", "hedera"]);
  });
});
