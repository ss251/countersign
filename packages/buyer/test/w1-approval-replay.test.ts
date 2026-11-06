import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import {
  approvalDecisionBody,
  approvalDecisionMessage,
  approvalRequestHash,
  canonicalHash,
  type ApprovalRequest,
  type CountersignExtra,
  type Envelope,
  type Offer,
} from "@countersign/core";
import { Journal, State, buy, countersignPayer } from "../src/index.ts";
import type { HubClient, KnownRail } from "../src/index.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// The approver's signed decision is bound to the approval id, and the hub chooses that id.
// Nothing in the decision is chosen by the agent for this request, so a hostile hub can hand
// one human "countersign" to a later held call for the same offer and amount.

const seller = privateKeyToAccount(generatePrivateKey());
const buyerAcct = privateKeyToAccount(generatePrivateKey());
const approverAcct = privateKeyToAccount(generatePrivateKey());
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const rail: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "https://rpc.testnet.arc.network",
};
const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);
const extra: CountersignExtra = {
  rail: "escrow",
  escrow: ESCROW,
  chainId: 5042002,
  offerHash,
  deadlineSeconds: 120,
  tokenName: "USDC",
  tokenVersion: "2",
};
const entry = {
  scheme: "countersign",
  network: "eip155:5042002",
  amount: PRICE,
  asset: TOKEN,
  payTo: seller.address,
  maxTimeoutSeconds: 120,
  extra,
};

type Decided = { decidedAt: number; decisionSig: string };

/**
 * Two held calls to the same offer against a hub that answers every approval request with the
 * id "a1". `decide` is the human: it runs once, on the first request the hub receives, and its
 * answer is what the hub serves for "a1" from then on. Returns the payment signatures made.
 */
async function twoHeldCalls(decide: (request: Record<string, unknown>) => Promise<Decided>) {
  let requests = 0;
  let decided: Decided | undefined;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/approvals") {
        requests += 1;
        const posted = (await req.json()) as Record<string, unknown>;
        decided ??= await decide(posted);
        // Every request is answered with the id the human already decided.
        return Response.json({ id: "a1" }, { status: 201 });
      }
      if (url.pathname === "/approvals/a1" && decided) {
        return Response.json({ status: "countersign", ...decided });
      }
      return Response.json({ ok: true });
    },
  });
  try {
    let signatures = 0;
    const hub = {
      url: `http://127.0.0.1:${server.port}`,
      getOffer: async () => ({ offerHash, offer, online: true, status: "listed" }),
      call: async (_h: unknown, _i: unknown, payment?: unknown) => {
        if (payment) {
          signatures += 1;
          return { kind: "error", status: 500, code: "x", message: "stop" };
        }
        return { kind: "required", required: { x402Version: 2, resource: { url: "x" }, accepts: [entry] } };
      },
    } as unknown as HubClient;
    const dir = mkdtempSync(join(tmpdir(), "w1-b14-"));
    const journal = new Journal(join(dir, "journal.jsonl"));
    const state = new State(dir);
    // ask-above is below the price, so every call to this offer needs the approver.
    const envelope = {
      cap: "10000000",
      perMerchant: "10000000",
      allowlist: [seller.address],
      askAbove: "1",
      approver: approverAcct.address,
    } as Envelope;
    const run = (now: number) =>
      buy({
        hub,
        offerHash,
        input: {},
        payers: [countersignPayer(buyerAcct)],
        envelope,
        journal,
        state,
        now,
        approvals: "hub",
        account: buyerAcct,
        known: [rail],
      }).catch(() => undefined);

    const t0 = Math.floor(Date.now() / 1000) - 20;
    await run(t0); // the call the human countersigned
    const afterFirst = signatures;
    await run(t0 + 10); // a second held call ten seconds later; no human decided it
    return { requests, afterFirst, signatures };
  } finally {
    server.stop(true);
  }
}

function sign(input: Parameters<typeof approvalDecisionBody>[0]): Promise<string> {
  return approverAcct.signMessage({ message: approvalDecisionMessage(approvalDecisionBody(input)) });
}

describe("W1 B14: one signed approval clears two held calls", () => {
  test("a hub that reuses a decided approval id gets no second payment from a request-bound decision", async () => {
    const r = await twoHeldCalls(async (request) => {
      // The phone signs the request it was shown, as the hub serves it.
      const decidedAt = Math.floor(Date.now() / 1000);
      const decisionSig = await sign({
        approvalId: "a1",
        agent: buyerAcct.address,
        offerHash,
        amount: PRICE,
        rail: "escrow",
        terms: entry,
        requestHash: approvalRequestHash(request as unknown as ApprovalRequest),
        decision: "countersign",
        decidedAt,
      });
      return { decidedAt, decisionSig };
    });
    expect(r.afterFirst).toBe(1); // the decided call is paid
    expect(r.requests).toBe(2);
    expect(r.signatures).toBe(1); // the undecided one is not
  });

  test("a decision bound only to the approval id never clears two calls either", async () => {
    // A body without a request hash: the hub chooses the id, so only the agent's own record of
    // consumed ids keeps it to one call. Refusing such bodies outright also passes.
    const r = await twoHeldCalls(async () => {
      const decidedAt = Math.floor(Date.now() / 1000) - 19;
      const decisionSig = await sign({
        approvalId: "a1",
        agent: buyerAcct.address,
        offerHash,
        amount: PRICE,
        rail: "escrow",
        terms: entry,
        decision: "countersign",
        decidedAt,
      });
      return { decidedAt, decisionSig };
    });
    expect(r.requests).toBe(2);
    expect(r.signatures).toBeLessThanOrEqual(1);
  });
});
