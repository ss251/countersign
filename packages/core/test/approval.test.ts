import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalDecisionSigner,
  approvalRequestHash,
  termsHashOf,
  type ApprovalDecisionInput,
  type ApprovalRequest,
} from "../src/index.ts";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(KEY);

const REQUEST: ApprovalRequest = {
  agent: account.address,
  offerHash: `0x${"22".repeat(32)}`,
  title: "Echo",
  amount: "250000",
  rail: "escrow",
  terms: { offerHash: `0x${"22".repeat(32)}`, amount: "250000", deadline: 120 },
  requestedAt: 1_700_000_000,
  nonce: `0x${"44".repeat(32)}`,
};
const requestHash = approvalRequestHash(REQUEST);
const OTHER_HASH = approvalRequestHash({ ...REQUEST, nonce: `0x${"55".repeat(32)}` });

const BASE: ApprovalDecisionInput = {
  approvalId: "ab".repeat(16),
  agent: account.address,
  offerHash: `0x${"22".repeat(32)}`,
  amount: "250000",
  rail: "escrow",
  terms: { offerHash: `0x${"22".repeat(32)}`, amount: "250000", deadline: 120 },
  requestHash,
  decision: "countersign",
  decidedAt: 1_700_000_000,
};

async function sign(input: ApprovalDecisionInput): Promise<{ body: ReturnType<typeof approvalDecisionBody>; sig: string }> {
  const body = approvalDecisionBody(input);
  const sig = await account.signMessage({ message: approvalDecisionMessage(body) });
  return { body, sig };
}

describe("approval request hash", () => {
  test("is stable across key order", () => {
    const shuffled = {
      nonce: REQUEST.nonce,
      requestedAt: REQUEST.requestedAt,
      terms: { deadline: 120, amount: "250000", offerHash: `0x${"22".repeat(32)}` },
      rail: REQUEST.rail,
      amount: REQUEST.amount,
      title: REQUEST.title,
      offerHash: REQUEST.offerHash,
      agent: REQUEST.agent,
    };
    expect(approvalRequestHash(shuffled)).toBe(requestHash);
  });

  test("a different nonce, title or requestedAt changes the hash", () => {
    expect(approvalRequestHash({ ...REQUEST, nonce: `0x${"55".repeat(32)}` })).not.toBe(requestHash);
    expect(approvalRequestHash({ ...REQUEST, title: "Other" })).not.toBe(requestHash);
    expect(approvalRequestHash({ ...REQUEST, requestedAt: REQUEST.requestedAt + 1 })).not.toBe(requestHash);
  });

  test("a decision signed for one requestHash does not verify for another", async () => {
    const { sig } = await sign(BASE);
    const other = approvalDecisionBody({ ...BASE, requestHash: OTHER_HASH });
    expect(await approvalDecisionSigner(other, sig)).not.toBe(account.address);
  });
});

describe("approval decision signature", () => {
  test("recovers to the signer", async () => {
    const { body, sig } = await sign(BASE);
    expect(body.v).toBe(2);
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
      { ...BASE, requestHash: OTHER_HASH },
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
