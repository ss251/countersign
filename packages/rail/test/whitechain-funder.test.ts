import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import type { Address } from "viem";
import { whitechainRail } from "../src/whitechain/index.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const RELAYER = "0xa2eefc657138ee5367291f8e2ac45bac28486006" as Address;

describe("the whitechain rail's Lock funder", () => {
  test("version 2 declares the relay's submitting address as the funder, checksummed", () => {
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2, funder: RELAYER });
    expect(rail.funder).toBe(getAddress(RELAYER));
  });

  test("version 2 without a funder declares none, so the hub refuses a bonded job", () => {
    const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
    expect(rail.funder).toBeUndefined();
  });

  test("version 1 never declares a funder, because v1 has no bonded Lock", () => {
    const rail = whitechainRail({ relayUrl: "http://relay", funder: RELAYER });
    expect(rail.funder).toBeUndefined();
  });
});
