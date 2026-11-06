import { describe, expect, test } from "bun:test";
import { newHubReleaseKey } from "@countersign/rail/hedera";
import { railsFromEnv } from "../src/rails.ts";

describe("the held rail needs the hub's release key", () => {
  test("stays off without HEDERA_HELD_HUB_KEY, in one line that carries no value", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv({ HEDERA_SCHEDULED_RAIL: "1" }, {}, (line) => lines.push(line));
    expect(rails).toEqual([]);
    expect(lines).toEqual(["[hub] rail hedera-scheduled is off: HEDERA_HELD_HUB_KEY is not set"]);
    expect(lines[0]).not.toContain("undefined");
  });

  test("starts when a generated hub key is set", async () => {
    const key = newHubReleaseKey();
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { HEDERA_SCHEDULED_RAIL: "1", HEDERA_HELD_HUB_KEY: key },
      {},
      (line) => lines.push(line),
    );
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["hedera-scheduled"]);
    expect(lines).toEqual([]);
  });
});
