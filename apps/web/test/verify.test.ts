import { describe, expect, test } from "bun:test";
import type { Slip } from "@countersign/core";
import catalogue from "../src/fixtures/catalogue.json";
import { parseSlip, verifySlip } from "../src/lib/verify.ts";

const slips = (catalogue.slips as unknown as Array<{ slip: Slip; title: string }>).map((s) => s.slip);
const escrowSlip = slips.find((s) => s.payment.accepted.scheme === "countersign")!;
const clone = (s: Slip): Slip => structuredClone(s);

describe("verifySlip", () => {
  test("every signed fixture slip is valid", async () => {
    for (const slip of slips) {
      const v = await verifySlip(slip);
      expect(v.checks.filter((c) => c.state === "fail")).toEqual([]);
      expect(v.valid).toBe(true);
    }
  });

  test("a changed amount breaks the hash", async () => {
    const s = clone(escrowSlip);
    s.body.amount = "60000";
    const v = await verifySlip(s);
    expect(v.valid).toBe(false);
    expect(v.checks.find((c) => c.id === "hash")?.state).toBe("fail");
  });

  test("a signature from someone else is refused", async () => {
    const s = clone(escrowSlip);
    const other = slips.find((x) => x.body.seller !== s.body.seller)!;
    s.sellerSig = other.sellerSig;
    const v = await verifySlip(s);
    expect(v.checks.find((c) => c.id === "seller")?.state).toBe("fail");
  });

  test("a countersignature for another offer is refused", async () => {
    const s = clone(escrowSlip);
    const payload = s.payment.payload as { terms: { offerHash: string } };
    payload.terms.offerHash = `0x${"11".repeat(32)}`;
    const v = await verifySlip(s);
    expect(v.checks.find((c) => c.id === "countersign")?.state).toBe("fail");
  });
});

describe("parseSlip", () => {
  test("accepts a bare slip and a paid-call response", () => {
    expect("slip" in parseSlip(JSON.stringify(escrowSlip))).toBe(true);
    expect("slip" in parseSlip(JSON.stringify({ output: {}, slip: escrowSlip }))).toBe(true);
  });
  test("says what is wrong with anything else", () => {
    expect(parseSlip("{").toString()).toBeTruthy();
    expect("error" in parseSlip("{}")).toBe(true);
    expect("error" in parseSlip("not json")).toBe(true);
  });
});
