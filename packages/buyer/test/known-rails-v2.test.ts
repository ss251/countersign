/**
 * The buyer pins escrow v2 AS v2 beside v1 (STEER-0300 C2, cs-w1's pre-flight point 1): a rail
 * that does not say version 2 derives the v1 job id and refuses a v2 402, so production can point
 * at v2 only once these pins ship. v1 stays pinned, so a revert to v1 still pays.
 */

import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@countersign/core";
import { getAddress } from "viem";
import { KNOWN_RAILS, payableVia, type CatalogueItem } from "../src/index.ts";
import { KNOWN_ESCROWS } from "../../verify/src/known-escrows.ts";

const ARC_V2 = "0x10A3c07cc6A519C0106e315D2C42010eCbEFF3CE";
const WC_V2 = "0x55b3d98C17Ba0878DC93fB1521c76c9a10778391";
const HASH = `0x${"cd".repeat(32)}` as const;

const railFor = (escrow: string) => KNOWN_RAILS.find((rail) => rail.escrow.toLowerCase() === escrow.toLowerCase());

function v2Offer(escrow: string): PaymentRequirements {
  const rail = railFor(escrow)!;
  return {
    scheme: "countersign",
    network: rail.network,
    amount: "10000",
    asset: rail.token,
    payTo: "0x0000000000000000000000000000000000000001",
    maxTimeoutSeconds: 600,
    extra: {
      rail: rail.chainId === 1874 ? "whitechain" : "escrow",
      escrow: rail.escrow,
      chainId: rail.chainId,
      offerHash: HASH,
      deadlineSeconds: 600,
      tokenName: rail.tokenName,
      tokenVersion: rail.tokenVersion,
    },
  };
}

const item = (accepts: PaymentRequirements[]): CatalogueItem => ({
  resource: `http://hub.test/offers/${HASH}/call`,
  type: "http",
  accepts,
  metadata: { provider: { name: "countersign" }, method: "POST" },
});

describe("escrow v2 is pinned as v2, beside v1", () => {
  test("Arc v2 is pinned with version 2, on USDC", () => {
    const rail = railFor(ARC_V2);
    expect(rail?.escrow).toBe(getAddress(ARC_V2));
    expect(rail?.version).toBe(2);
    expect(rail?.chainId).toBe(5042002);
    expect(rail?.token).toBe("0x3600000000000000000000000000000000000000");
    expect([rail?.tokenName, rail?.tokenVersion]).toEqual(["USDC", "2"]);
  });

  test("Whitechain v2 is pinned with version 2, on USDT", () => {
    const rail = railFor(WC_V2);
    expect(rail?.escrow).toBe(getAddress(WC_V2));
    expect(rail?.version).toBe(2);
    expect(rail?.chainId).toBe(1874);
    expect(rail?.token).toBe("0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7");
    expect([rail?.tokenName, rail?.tokenVersion]).toEqual(["Tether USD", "1"]);
  });

  test("every v1 rail stays pinned as v1, so a revert to v1 still pays", () => {
    for (const v1 of [
      "0x19c27d770969291e6a0a305dc1be1a845e7c1b76",
      "0x44d11b8909485e3f575F6628b689383E4420f54a",
      "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4",
    ]) {
      expect(railFor(v1)?.version ?? 1).toBe(1);
    }
  });

  test("a v2 offer is payable through its v2 rail", () => {
    expect(payableVia(item([v2Offer(ARC_V2)]), KNOWN_RAILS)?.kind).toBe("escrow");
    expect(payableVia(item([v2Offer(WC_V2)]), KNOWN_RAILS)?.kind).toBe("escrow");
  });

  test("the buyer's escrow pins match the verifier's, so what it pays it can verify", () => {
    for (const rail of KNOWN_RAILS) {
      expect(
        KNOWN_ESCROWS.some((pin) => pin.chainId === rail.chainId && pin.escrow.toLowerCase() === rail.escrow.toLowerCase()),
      ).toBe(true);
    }
  });
});
