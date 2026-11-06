import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalDecisionSigner,
  termsHashOf,
  type ApprovalDecisionInput,
} from "../src/index.ts";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(KEY);

const BASE: ApprovalDecisionInput = {
  approvalId: "ab".repeat(16),
  agent: account.address,
  offerHash: `0x${"22".repeat(32)}`,
  amount: "250000",
  rail: "escrow",
  terms: { offerHash: `0x${"22".repeat(32)}`, amount: "250000", deadline: 120 },
  decision: "countersign",
  decidedAt: 1_700_000_000,
};

async function sign(input: ApprovalDecisionInput): Promise<{ body: ReturnType<typeof approvalDecisionBody>; sig: string }> {
  const body = approvalDecisionBody(input);
  const sig = await account.signMessage({ message: approvalDecisionMessage(body) });
  return { body, sig };
}

describe("approval decision signature", () => {
  test("recovers to the signer", async () => {
    const { body, sig } = await sign(BASE);
    expect(await approvalDecisionSigner(body, sig)).toBe(account.address);
  });

  test("changing any single field recovers a different address", async () => {
    const { sig } = await sign(BASE);
    const variants: ApprovalDecisionInput[] = [
      { ...BASE, amount: "250001" },
      { ...BASE, offerHash: `0x${"33".repeat(32)}` },
      { ...BASE, rail: "gateway" },
      { ...BASE, terms: { offerHash: `0x${"22".repeat(32)}`, amount: "250000", deadline: 121 } },
      { ...BASE, decision: "decline" },
      { ...BASE, decidedAt: 1_700_000_001 },
      { ...BASE, approvalId: "cd".repeat(16) },
    ];
    for (const variant of variants) {
      expect(await approvalDecisionSigner(approvalDecisionBody(variant), sig)).not.toBe(account.address);
    }
  });

  test("termsHashOf does not depend on key order", () => {
    expect(termsHashOf({ a: 1, b: 2 })).toBe(termsHashOf({ b: 2, a: 1 }));
  });

  test("a malformed signature gives null", async () => {
    expect(await approvalDecisionSigner(approvalDecisionBody(BASE), "0xdeadbeef")).toBeNull();
  });
});
