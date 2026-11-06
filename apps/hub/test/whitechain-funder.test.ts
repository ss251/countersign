import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { railsFromEnv } from "../src/rails.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const RELAYER = getAddress("0xa2EEfc657138eE5367291F8e2Ac45BAC28486006");

describe("the hub's whitechain Lock funder", () => {
  test("WC_RELAY_FUNDER on v2 becomes the rail's funder, with no log line", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "2", WC_ESCROW_V2: V2, WC_RELAY_FUNDER: RELAYER },
      {},
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["whitechain"]);
    expect(rails[0]!.funder).toBe(RELAYER);
  });

  test("an invalid WC_RELAY_FUNDER keeps the rail on, declares no funder and logs one line", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "2", WC_ESCROW_V2: V2, WC_RELAY_FUNDER: "not-an-address" },
      {},
      (line) => lines.push(line),
    );
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["whitechain"]);
    expect(rails[0]!.funder).toBeUndefined();
    expect(lines).toEqual(["[hub] WC_RELAY_FUNDER is not an address, so whitechain refuses bonded jobs"]);
  });

  test("v1 ignores WC_RELAY_FUNDER", async () => {
    const rails = await railsFromEnv({ WC_RELAY_URL: "http://relay", WC_RELAY_FUNDER: RELAYER }, {}, () => {});
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["whitechain"]);
    expect(rails[0]!.funder).toBeUndefined();
  });
});
