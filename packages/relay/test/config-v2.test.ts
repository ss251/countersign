import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { loadRelayConfig } from "../src/config.ts";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";

const BASE = {
  WC_RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  RELAY_DB: ":memory:",
};
const V2 = "0x7777777777777777777777777777777777777777";

describe("escrow v2 configuration", () => {
  test("the allowlist holds v1 and v2 when WC_ESCROW_V2 is set", () => {
    const config = loadRelayConfig({ ...BASE, WC_ESCROW_V2: V2 });
    expect(config.policy.allowedEscrows).toEqual([WHITECHAIN_ESCROW, getAddress(V2)]);
    expect(config.policy.escrowV2).toBe(getAddress(V2));
  });

  test("without WC_ESCROW_V2 only v1 is allowed", () => {
    const config = loadRelayConfig(BASE);
    expect(config.policy.allowedEscrows).toEqual([WHITECHAIN_ESCROW]);
    expect(config.policy.escrowV2).toBeUndefined();
  });

  test("a WC_ESCROW_V2 that is not an address refuses to load", () => {
    expect(() => loadRelayConfig({ ...BASE, WC_ESCROW_V2: "not-an-address" })).toThrow("WC_ESCROW_V2");
  });

  test("RELAY_HUB_TOKEN is optional, and shorter than 24 characters refuses to load", () => {
    expect(loadRelayConfig(BASE).hubToken).toBeUndefined();
    expect(loadRelayConfig({ ...BASE, RELAY_HUB_TOKEN: "  " }).hubToken).toBeUndefined();
    expect(() => loadRelayConfig({ ...BASE, RELAY_HUB_TOKEN: "a".repeat(23) })).toThrow(
      "RELAY_HUB_TOKEN must be at least 24 characters",
    );
    expect(loadRelayConfig({ ...BASE, RELAY_HUB_TOKEN: "a".repeat(24) }).hubToken).toBe("a".repeat(24));
  });
});
