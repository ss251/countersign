import { describe, expect, test } from "bun:test";
import {
  sessionEnvelopeProblems,
  SESSION_SKEW,
  SESSION_TTL,
  type SessionEnvelope,
} from "../lib/envelope.ts";

const NOW = 1_800_000_000;
const WALLET = "0xabc0000000000000000000000000000000000001";
const OTHER = "0xdef0000000000000000000000000000000000002";

const GOOD: SessionEnvelope = {
  v: 1,
  agent: WALLET,
  cap: "1000000",
  perMerchant: "500000",
  askAbove: "50000",
  allowlist: [],
  revoked: false,
  expiresAt: NOW + SESSION_TTL,
  approver: WALLET,
};

function problems(patch: SessionEnvelope): string[] {
  return sessionEnvelopeProblems({ ...GOOD, ...patch }, WALLET, NOW);
}

describe("the session envelope checks", () => {
  test("a correct envelope has no problem", () => {
    expect(sessionEnvelopeProblems(GOOD, WALLET, NOW)).toEqual([]);
  });

  test("the wallet compares case-insensitively", () => {
    expect(sessionEnvelopeProblems(GOOD, WALLET.toUpperCase(), NOW)).toEqual([]);
  });

  test("a wrong cap names cap", () => {
    const found = problems({ cap: "999999" });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("cap");
  });

  test("a wrong askAbove names askAbove", () => {
    const found = problems({ askAbove: "100" });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("askAbove");
  });

  test("a wrong perMerchant names perMerchant", () => {
    const found = problems({ perMerchant: "100" });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("perMerchant");
  });

  test("a non-empty allowlist names allowlist", () => {
    const found = problems({ allowlist: [OTHER] });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("allowlist");
  });

  test("revoked true names revoked", () => {
    const found = problems({ revoked: true });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("revoked");
  });

  test("an agent that is not the wallet names agent", () => {
    const found = problems({ agent: OTHER });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("agent");
  });

  test("an approver that is not the wallet names approver", () => {
    const found = problems({ approver: OTHER });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("approver");
  });

  test("an expiresAt in the past names expiresAt", () => {
    const found = problems({ expiresAt: NOW });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("expiresAt");
  });

  test("an expiresAt more than 24 h and 5 min ahead names expiresAt", () => {
    const found = problems({ expiresAt: NOW + SESSION_TTL + SESSION_SKEW + 1 });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("expiresAt");
  });

  test("an expiresAt exactly 24 h and 5 min ahead is still accepted", () => {
    expect(problems({ expiresAt: NOW + SESSION_TTL + SESSION_SKEW })).toEqual([]);
  });
});
