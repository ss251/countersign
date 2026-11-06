import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import type { Offer } from "@countersign/core";
import { WHITECHAIN_ESCROW } from "@countersign/rail";
import { railsFromEnv } from "../src/rails.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const offer: Offer = {
  v: 1,
  seller: "0x1111111111111111111111111111111111111111",
  title: "t",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1500000",
  deadline: 120,
  bond: "0",
  rails: ["whitechain"],
  issuedAt: 1,
};

describe("the hub's whitechain rail on v2", () => {
  test("version 2 with a v2 escrow starts the rail on that escrow", async () => {
    const lines: string[] = [];
    const rails = await railsFromEnv(
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "2", WC_ESCROW_V2: V2 },
      {},
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
    expect(rails.map((rail) => rail.declaration.id)).toEqual(["whitechain"]);
    expect(rails[0]!.declaration.escrow).toBe(V2);
    expect(rails[0]!.challenge(offer, { resource: "x", now: 0 }).extra).toMatchObject({
      escrow: V2,
      escrowVersion: 2,
    });
  });

  test("version 2 without WC_ESCROW_V2 leaves the rail off with one log line", async () => {
    for (const env of [
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "2" },
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "2", WC_ESCROW_V2: "not-an-address" },
    ]) {
      const lines: string[] = [];
      const rails = await railsFromEnv(env, {}, (line) => lines.push(line));
      expect(rails).toEqual([]);
      expect(lines).toEqual(["[hub] rail whitechain is off: WC_ESCROW_VERSION=2 needs WC_ESCROW_V2"]);
    }
  });

  test("unset or 1 stays on v1", async () => {
    for (const env of [
      { WC_RELAY_URL: "http://relay" },
      { WC_RELAY_URL: "http://relay", WC_ESCROW_VERSION: "1", WC_ESCROW_V2: V2 },
    ]) {
      const rails = await railsFromEnv(env, {}, () => undefined);
      expect(rails[0]!.declaration.escrow).toBe(WHITECHAIN_ESCROW);
    }
  });
});
