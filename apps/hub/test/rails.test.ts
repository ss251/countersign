import { describe, expect, test } from "bun:test";
import type { Rail } from "@countersign/rail";
import { railsFromEnv } from "../src/rails.ts";

function fakeRail(id: string): Rail {
  return { declaration: { id } } as unknown as Rail;
}

describe("railsFromEnv", () => {
  test("starts gateway and hedera when their flags are set", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { GATEWAY_RAIL: "1", HEDERA_RAIL: "1" },
      { gateway: async () => fakeRail("gateway"), hedera: async () => fakeRail("hedera") },
      (line) => lines.push(line),
    );
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["gateway", "hedera"]);
    expect(lines).toEqual([]);
  });

  test("a facilitator that is away at boot turns its rail off without stopping the hub", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { GATEWAY_RAIL: "1", HEDERA_RAIL: "1" },
      {
        gateway: async () => {
          throw new Error("fetch failed\nstack line");
        },
        hedera: async () => fakeRail("hedera"),
      },
      (line) => lines.push(line),
    );
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["hedera"]);
    expect(lines).toEqual(["[hub] rail gateway is off: fetch failed"]);
  });

  test("flags other than 1 leave a rail off and call nothing", async () => {
    let called = false;
    const rails = await railsFromEnv(
      { GATEWAY_RAIL: "true", HEDERA_RAIL: "0" },
      {
        gateway: async () => {
          called = true;
          return fakeRail("gateway");
        },
      },
      () => undefined,
    );
    expect(rails).toEqual([]);
    expect(called).toBe(false);
  });
});
