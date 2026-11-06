import { describe, expect, test } from "bun:test";
import { checkEnvelope, needsHuman, recordSpend, type Envelope, type EnvelopeSpend } from "../src/index.ts";

const SELLER = "0x3333333333333333333333333333333333333333";
const OTHER = "0x5555555555555555555555555555555555555555";

const env: Envelope = {
  v: 1,
  agent: "0x2222222222222222222222222222222222222222",
  cap: "5000000", // 5 USDC
  perMerchant: "2000000", // 2 USDC
  allowlist: [],
  revoked: false,
};
const none: EnvelopeSpend = { total: "0", bySeller: {} };
const req = (amount: string, seller = SELLER) => ({ seller, offerHash: "0xabc", amount });

describe("envelope", () => {
  test("approves inside every limit", () => {
    expect(checkEnvelope(env, none, req("1000000"), 0)).toEqual({ ok: true });
  });

  test("refuses past the per-merchant limit, case-insensitively", () => {
    const spent = recordSpend(none, req("1500000", SELLER.toUpperCase().replace("0X", "0x")));
    const d = checkEnvelope(env, spent, req("600000"), 0);
    expect(d.ok === false && d.reason).toBe("over-merchant-limit");
    expect(checkEnvelope(env, spent, req("600000", OTHER), 0)).toEqual({ ok: true });
  });

  test("refuses past the cap and says by how much", () => {
    let spent = none;
    for (const s of [SELLER, OTHER]) spent = recordSpend(spent, req("2000000", s));
    const d = checkEnvelope(env, spent, req("1000001", "0x6666666666666666666666666666666666666666"), 0);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("over-cap");
      expect(d.message).toBe("Refused. This would spend 5.000001 of a 5 budget.");
    }
  });

  test("merchant overrides beat the default", () => {
    const e = { ...env, merchantLimits: { [SELLER]: "100" } };
    expect(checkEnvelope(e, none, req("101"), 0).ok).toBe(false);
  });

  test("allowlist admits by seller or offer hash", () => {
    const e = { ...env, allowlist: [OTHER, "0xABC"] };
    expect(checkEnvelope(e, none, { seller: SELLER, offerHash: "0xdef", amount: "1" }, 0).ok).toBe(false);
    expect(checkEnvelope(e, none, { seller: SELLER, offerHash: "0xabc", amount: "1" }, 0).ok).toBe(true);
    expect(checkEnvelope(e, none, { seller: OTHER, offerHash: "0xdef", amount: "1" }, 0).ok).toBe(true);
  });

  test("revoked and expired envelopes approve nothing", () => {
    const r = checkEnvelope({ ...env, revoked: true }, none, req("1"), 0);
    expect(r.ok === false && r.message).toBe("Refused. The envelope was revoked.");
    const x = checkEnvelope({ ...env, expiresAt: 100 }, none, req("1"), 100);
    expect(x.ok === false && x.reason).toBe("expired");
  });
});

describe("askAbove", () => {
  test("holds only above the threshold", () => {
    expect(needsHuman(env, "1")).toBe(false);
    const e = { ...env, askAbove: "500000" };
    expect(needsHuman(e, "500000")).toBe(false);
    expect(needsHuman(e, "500001")).toBe(true);
  });
});
