/**
 * KNOWN_ESCROWS is the pin every verifier, runner and phone trusts: a slip or a job on an escrow
 * outside it is refused. Each entry is checked on chain by hand before it is added (the bytecode at
 * the address and its deploy receipt); this file pins the list's own shape.
 */

import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { KNOWN_ESCROWS } from "../src/known-escrows.ts";

const ARC_TESTNET = 5042002;
const WHITECHAIN_TESTNET = 1874;

describe("the escrows this verifier trusts", () => {
  test("every pin is a well-formed address on a chain the product runs on", () => {
    for (const entry of KNOWN_ESCROWS) {
      expect(() => getAddress(entry.escrow)).not.toThrow();
      expect([ARC_TESTNET, WHITECHAIN_TESTNET]).toContain(entry.chainId);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  test("no (chain, escrow) pair is pinned twice", () => {
    const pairs = KNOWN_ESCROWS.map((entry) => `${entry.chainId}:${entry.escrow.toLowerCase()}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  test("Whitechain's escrow v2 is pinned, so runners and the phone take its jobs", () => {
    const v2 = KNOWN_ESCROWS.find(
      (entry) =>
        entry.chainId === WHITECHAIN_TESTNET &&
        entry.escrow.toLowerCase() === "0x55b3d98c17ba0878dc93fb1521c76c9a10778391",
    );
    expect(v2?.escrow).toBe(getAddress("0x55b3d98c17ba0878dc93fb1521c76c9a10778391"));
    expect(v2?.name).toMatch(/escrow v2/);
  });

  test("Arc's escrow v2 is pinned beside its v1 deployments", () => {
    const v2 = KNOWN_ESCROWS.find(
      (entry) => entry.chainId === ARC_TESTNET && entry.escrow.toLowerCase() === "0x10a3c07cc6a519c0106e315d2c42010ecbeff3ce",
    );
    expect(v2?.escrow).toBe(getAddress("0x10a3c07cc6a519c0106e315d2c42010ecbeff3ce"));
    expect(v2?.name).toMatch(/escrow v2/);
    // The v1 deployments that hold today's Arc jobs stay.
    expect(KNOWN_ESCROWS.filter((entry) => entry.chainId === ARC_TESTNET).length).toBe(3);
  });

  test("Whitechain's v1 escrow stays pinned, so its open jobs still verify", () => {
    expect(
      KNOWN_ESCROWS.some(
        (entry) =>
          entry.chainId === WHITECHAIN_TESTNET &&
          entry.escrow.toLowerCase() === "0x9279d3edeef4c3738a0b200d762e2985ff3b7eb4",
      ),
    ).toBe(true);
  });
});
