import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  checkCountersign,
  countersignPayload,
  jobIdOf,
  type AuthorizationInput,
  type CountersignTerms,
} from "../src/index.ts";

// Fixed test keys. They hold nothing on any chain.
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const other = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const NOW = 1_762_400_000;

function input(terms: Partial<CountersignTerms> = {}): AuthorizationInput {
  return {
    terms: {
      offerHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      buyer: buyer.address,
      payee: "0x3333333333333333333333333333333333333333",
      amount: "1500000",
      deadline: NOW + 300,
      salt: "42",
      ...terms,
    },
    chainId: 5042002,
    escrow: ESCROW,
    token: USDC,
    tokenName: "USDC",
    tokenVersion: "2",
    validAfter: 0,
    validBefore: NOW + 600,
  };
}

const ctx = { chainId: 5042002, escrow: ESCROW, token: USDC, tokenName: "USDC", tokenVersion: "2", now: NOW };

async function signed(i = input()) {
  const signature = await buyer.signTypedData(authorizationTypedData(i));
  return countersignPayload(i, signature);
}

describe("jobId", () => {
  test("matches the contract's jobIdFor (vector shared with contracts/test/Parity.t.sol)", () => {
    const jobId = jobIdOf(
      {
        offerHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        buyer: "0x2222222222222222222222222222222222222222",
        payee: "0x3333333333333333333333333333333333333333",
        amount: "1500000",
        deadline: 1_762_400_300,
        salt: "42",
      },
      5042002,
      ESCROW,
    );
    expect(jobId).toBe("0x1106bd955f6f3268bd9bd592353e8f40d1bd412ad0e6c5bfd8919b1fac4951c9");
  });

  test("changes with every term", () => {
    const base = jobIdOf(input().terms, 5042002, ESCROW);
    const variants: Partial<CountersignTerms>[] = [
      { amount: "1500001" },
      { payee: "0x5555555555555555555555555555555555555555" },
      { deadline: NOW + 301 },
      { salt: "43" },
      { offerHash: "0x2111111111111111111111111111111111111111111111111111111111111111" },
    ];
    for (const v of variants) expect(jobIdOf(input(v).terms, 5042002, ESCROW)).not.toBe(base);
    expect(jobIdOf(input().terms, 1874, ESCROW)).not.toBe(base);
    expect(jobIdOf(input().terms, 5042002, "0x5555555555555555555555555555555555555555")).not.toBe(base);
  });
});

describe("checkCountersign", () => {
  test("accepts the buyer's own signature", async () => {
    const p = await signed();
    const r = await checkCountersign(p, ctx);
    expect(r).toEqual({ ok: true, jobId: jobIdOf(p.terms, 5042002, ESCROW), buyer: buyer.address });
    expect(p.authorization.nonce).toBe(jobIdOf(p.terms, 5042002, ESCROW));
  });

  test("refuses a moved price", async () => {
    const p = await signed();
    const moved = { ...p, terms: { ...p.terms, amount: "2000000" } };
    const r = await checkCountersign(moved, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("terms-mismatch");

    // Moving both the terms and the authorisation value still fails: the nonce no longer derives.
    const both = { ...moved, authorization: { ...p.authorization, value: "2000000" } };
    const r2 = await checkCountersign(both, ctx);
    expect(r2.ok).toBe(false);
  });

  test("refuses a re-derived nonce with the old signature", async () => {
    const p = await signed();
    const terms = { ...p.terms, amount: "2000000" };
    const nonce: Hex = jobIdOf(terms, 5042002, ESCROW);
    const forged = { ...p, terms, authorization: { ...p.authorization, value: "2000000", nonce } };
    const r = await checkCountersign(forged, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad-signature");
  });

  test("refuses someone else's signature", async () => {
    const i = input();
    const signature = await other.signTypedData(authorizationTypedData(i));
    const r = await checkCountersign(countersignPayload(i, signature), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad-signature");
  });

  test("refuses an expired or early authorisation", async () => {
    const p = await signed();
    const late = await checkCountersign(p, { ...ctx, now: NOW + 600 });
    expect(late.ok === false && late.reason).toBe("expired");
    const early = await signed({ ...input(), validAfter: NOW + 10 });
    const r = await checkCountersign(early, ctx);
    expect(r.ok === false && r.reason).toBe("not-yet-valid");
  });

  test("refuses another escrow", async () => {
    const p = await signed();
    const r = await checkCountersign(p, { ...ctx, escrow: "0x5555555555555555555555555555555555555555" });
    expect(r.ok === false && r.reason).toBe("terms-mismatch");
  });
});
