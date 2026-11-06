import { beforeEach, describe, expect, test } from "bun:test";
import {
  approvalDecisionBody,
  approvalDecisionSigner,
  approvalRequestHash,
  canonicalJson,
  type ApprovalRequest,
} from "@countersign/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { approverAddress, makeApprover, signDecision, SigningError } from "../src/lib/approver.ts";
import type { Approval } from "../src/lib/types.ts";

// The phone's key lives in localStorage; here, a fresh in-memory one per test.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const NOW = 1_793_990_000;
const OFFER = "0x" + "ab".repeat(32);
const TERMS = { deadline: 120, rails: ["escrow"], price: "30000" };

async function heldCall(over: { signer?: ReturnType<typeof privateKeyToAccount>; amount?: string } = {}) {
  const agent = privateKeyToAccount(generatePrivateKey());
  const request: ApprovalRequest = {
    agent: agent.address,
    offerHash: OFFER,
    title: "use-arc",
    amount: "30000",
    rail: "escrow",
    terms: TERMS,
    requestedAt: NOW - 5,
    nonce: `0x${"5a".repeat(32)}`,
  };
  const requestSig = await (over.signer ?? agent).signMessage({ message: canonicalJson(request) });
  const approval: Approval = {
    id: "9f1c0de0aa55",
    agent: agent.address,
    agentName: "0xagent",
    listing: { offer: { title: "use-arc" } } as unknown as Approval["listing"],
    amount: over.amount ?? "30000",
    rail: "escrow",
    discoveredVia: "registry",
    requestedAt: NOW - 5,
    signing: { offerHash: OFFER, terms: TERMS, request, requestSig },
  };
  return { agent, request, approval };
}

/** The body exactly as the hub (and then the agent) rebuilds it from its own copy of the request. */
function rebuilt(request: ApprovalRequest, approvalId: string, decision: "countersign" | "decline", decidedAt: number) {
  return approvalDecisionBody({
    approvalId,
    agent: request.agent,
    offerHash: request.offerHash,
    amount: request.amount,
    rail: request.rail,
    terms: request.terms,
    requestHash: approvalRequestHash(request),
    decision,
    decidedAt,
  });
}

beforeEach(() => store.clear());

describe("the phone's approver key and its version 2 decisions", () => {
  test("a decision signed on the phone recovers to its approver over the body the hub rebuilds", async () => {
    const phone = await makeApprover();
    expect(approverAddress()).toBe(phone);
    const { request, approval } = await heldCall();
    for (const decision of ["countersign", "decline"] as const) {
      const { decidedAt, sig } = await signDecision(approval, decision, NOW);
      expect(decidedAt).toBe(NOW);
      const signer = await approvalDecisionSigner(rebuilt(request, approval.id, decision, decidedAt), sig);
      expect(signer?.toLowerCase()).toBe(phone.toLowerCase());
    }
  });

  test("it is bound to this request: the same offer and amount under another request does not verify", async () => {
    const phone = await makeApprover();
    const { request, approval } = await heldCall();
    const { decidedAt, sig } = await signDecision(approval, "countersign", NOW);
    const other = { ...request, nonce: `0x${"6b".repeat(32)}` as const };
    const signer = await approvalDecisionSigner(rebuilt(other, approval.id, "countersign", decidedAt), sig);
    expect(signer?.toLowerCase()).not.toBe(phone.toLowerCase());
  });

  test("the key is made once: asked again, the phone keeps the same address", async () => {
    const first = await makeApprover();
    expect(await makeApprover()).toBe(first);
  });

  test("the phone refuses a request its agent did not sign, and signs nothing", async () => {
    await makeApprover();
    const { approval } = await heldCall({ signer: privateKeyToAccount(generatePrivateKey()) });
    const refused = await signDecision(approval, "countersign", NOW).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SigningError);
    expect((refused as SigningError).problem).toBe("not-the-agents");
  });

  test("the phone refuses when the agent signed an amount other than the one it shows", async () => {
    await makeApprover();
    const { approval } = await heldCall({ amount: "30001" });
    const refused = await signDecision(approval, "countersign", NOW).catch((e: unknown) => e);
    expect((refused as SigningError).problem).toBe("not-what-you-see");
  });

  test("without a key, or without the agent's signed request, nothing is signed", async () => {
    const { approval } = await heldCall();
    const noKey = await signDecision(approval, "countersign", NOW).catch((e: unknown) => e);
    expect((noKey as SigningError).problem).toBe("no-key");
    await makeApprover();
    const bare = { ...approval, signing: { ...approval.signing!, requestSig: null } };
    const noRequest = await signDecision(bare, "countersign", NOW).catch((e: unknown) => e);
    expect((noRequest as SigningError).problem).toBe("no-request");
  });
});
