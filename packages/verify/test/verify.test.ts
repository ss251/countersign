import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  canonicalHash,
  countersignPayload,
  jobIdOf,
  type Slip,
  slipBodyFor,
  slipHash,
  slipTypedData,
} from "@countersign/core";
import { verifySlip } from "../src/verify.ts";

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const stranger = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const OFFER = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

async function makeSlip(signer = seller): Promise<Slip> {
  const terms = { offerHash: OFFER, buyer: buyer.address, payee: seller.address, amount: "10000", deadline: 1_762_400_300, salt: "9" };
  const input = { terms, chainId: 5042002, escrow: ESCROW, token: USDC, tokenName: "USDC", tokenVersion: "2", validAfter: 0, validBefore: 1_762_400_600 };
  const payload = countersignPayload(input, await buyer.signTypedData(authorizationTypedData(input)));
  const jobId = jobIdOf(terms, 5042002, ESCROW);
  const body = slipBodyFor(
    { jobId, offerHash: OFFER, input: { q: 1 }, rail: "escrow", network: "eip155:5042002", buyer: buyer.address, payTo: seller.address, asset: USDC, amount: "10000", deadline: terms.deadline, escrow: ESCROW, chainId: 5042002, lineage: [] },
    seller.address,
    canonicalHash({ q: 1 }),
    canonicalHash({ a: 2 }),
    1_762_400_100,
  );
  return {
    body,
    hash: slipHash(body),
    sellerSig: await signer.signTypedData(slipTypedData(body)),
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:5042002",
        amount: "10000",
        asset: USDC,
        payTo: seller.address,
        maxTimeoutSeconds: 120,
        extra: { rail: "escrow", escrow: ESCROW, chainId: 5042002, offerHash: OFFER, deadlineSeconds: 120, tokenName: "USDC", tokenVersion: "2" },
      },
      payload: payload as unknown as Record<string, unknown>,
    },
    settlement: { transaction: "0xabc", network: "eip155:5042002" },
  };
}

describe("verifySlip offline", () => {
  test("a genuine slip is VALID with no hub and no network", async () => {
    const v = await verifySlip(await makeSlip());
    expect(v.findings.filter((f) => !f.ok)).toEqual([]);
    expect(v.valid).toBe(true);
  });

  test("a tampered amount is INVALID", async () => {
    const s = await makeSlip();
    const forged = { ...s, body: { ...s.body, amount: "20000" } };
    forged.hash = slipHash(forged.body);
    const v = await verifySlip(forged);
    expect(v.valid).toBe(false);
    expect(v.findings.find((f) => f.check === "seller")!.ok).toBe(false);
    expect(v.findings.find((f) => f.check === "terms")!.ok).toBe(false);
  });

  test("a slip signed by someone else is INVALID", async () => {
    const v = await verifySlip(await makeSlip(stranger));
    expect(v.valid).toBe(false);
    expect(v.findings.find((f) => f.check === "seller")!.detail).toContain("not the seller");
  });

  test("a hash that does not match its body is INVALID", async () => {
    const s = await makeSlip();
    const v = await verifySlip({ ...s, hash: "0x00" });
    expect(v.findings.find((f) => f.check === "hash")!.ok).toBe(false);
  });
});

describe("independence", () => {
  test("the verifier imports nothing from the hub", () => {
    const dir = join(import.meta.dir, "../src");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/apps\/hub|@countersign\/hub|@countersign\/rail/);
    }
  });
});
