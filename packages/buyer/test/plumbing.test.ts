import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import {
  PAYMENT_SIGNATURE_HEADER,
  canonicalHash,
  canonicalJson,
  checkCountersign,
  fromBase64Json,
  slipBodyFor,
  slipHash,
  slipTypedData,
  toBase64Json,
  type CountersignExtra,
  type CountersignPayload,
  type Envelope,
  type EnvelopeSpend,
  type Offer,
  type PaymentPayload,
  type Slip,
} from "@countersign/core";
import { BuyError, HubClient, Journal, State, buy, countersignPayer, publishEnvelope, requestApproval } from "../src/index.ts";
import type { KnownRail } from "../src/index.ts";

const SELLER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const seller = privateKeyToAccount(SELLER_KEY);
const agent = privateKeyToAccount(AGENT_KEY);
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const TEST_RAIL: KnownRail = {
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
  summary: "echoes",
  adapter: "skill",
  input: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
  output: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
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
const accepts = [
  {
    scheme: "countersign" as const,
    network: "eip155:5042002" as const,
    amount: PRICE,
    asset: TOKEN,
    payTo: seller.address,
    maxTimeoutSeconds: 120,
    extra,
  },
];

const servers: { stop: (force?: boolean) => void }[] = [];
afterAll(() => {
  for (const server of servers) server.stop(true);
});

function fresh(): { state: State; journal: Journal } {
  const dir = mkdtempSync(join(tmpdir(), "cs-plumbing-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    agent: agent.address,
    cap: "5000000",
    perMerchant: "5000000",
    allowlist: [],
    revoked: false,
    askAbove: "100000",
    ...over,
  };
}

async function makeSlip(payment: PaymentPayload, input: unknown, output: unknown): Promise<Slip> {
  const p = payment.payload as unknown as CountersignPayload;
  const body = slipBodyFor(
    {
      jobId: p.authorization.nonce,
      offerHash,
      input,
      rail: "escrow",
      network: "eip155:5042002",
      buyer: p.terms.buyer,
      payTo: seller.address,
      asset: TOKEN,
      amount: PRICE,
      deadline: p.terms.deadline,
      escrow: ESCROW,
      chainId: 5042002,
      lineage: [],
    },
    seller.address,
    canonicalHash(input),
    canonicalHash(output),
    1000,
  );
  const sellerSig = await seller.signTypedData(slipTypedData(body));
  return {
    body,
    hash: slipHash(body),
    sellerSig,
    payment,
    settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
  };
}

interface BuyHub {
  url: string;
  approvals: number;
  paid: number;
  mirrors: number;
  approvedAtPayment: boolean;
  approvalStatus: () => string;
}

function startBuyHub(options: {
  decision?: "countersign" | "decline";
  mirrorStatus?: number;
  verifyMirror?: boolean;
} = {}): BuyHub {
  let approvalStatus = "pending";
  let approvalCount = 0;
  let mirrorCount = 0;
  let approvedAtPayment = false;
  const state: BuyHub = {
    url: "",
    get approvals() {
      return approvalCount;
    },
    get paid() {
      return paidCount;
    },
    get mirrors() {
      return mirrorCount;
    },
    get approvedAtPayment() {
      return approvedAtPayment;
    },
    approvalStatus: () => approvalStatus,
  };
  let paidCount = 0;

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === `/offers/${offerHash}`) {
        return Response.json({ offerHash, offer, online: true, status: "listed" });
      }
      if (req.method === "POST" && url.pathname === "/approvals") {
        approvalCount += 1;
        const body = (await req.json()) as Record<string, unknown>;
        const { sig, ...signed } = body;
        if (typeof sig !== "string") return new Response("{}", { status: 400 });
        const signer = await recoverMessageAddress({ message: canonicalJson(signed), signature: sig as Hex });
        if (signer.toLowerCase() !== agent.address.toLowerCase()) {
          return new Response("{}", { status: 401 });
        }
        approvalStatus = "pending";
        return Response.json({ id: "ab".repeat(16) }, { status: 201 });
      }
      if (req.method === "GET" && url.pathname.startsWith("/approvals/")) {
        approvalStatus = options.decision ?? "countersign";
        return Response.json({ id: url.pathname.slice("/approvals/".length), status: approvalStatus });
      }
      if (req.method === "PUT" && url.pathname.startsWith("/envelopes/")) {
        mirrorCount += 1;
        if (options.mirrorStatus !== undefined && options.mirrorStatus !== 200) {
          return new Response("{}", { status: options.mirrorStatus });
        }
        if (options.verifyMirror) {
          const body = (await req.json()) as Record<string, unknown>;
          const { sig, ...signed } = body;
          if (typeof sig !== "string") return new Response("{}", { status: 400 });
          const signer = await recoverMessageAddress({ message: canonicalJson(signed), signature: sig as Hex });
          if (signer.toLowerCase() !== agent.address.toLowerCase()) {
            return new Response("{}", { status: 401 });
          }
        }
        return Response.json({ ok: true });
      }
      if (req.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
        const body = (await req.json()) as { input: unknown };
        const header = req.headers.get(PAYMENT_SIGNATURE_HEADER);
        if (!header) {
          return Response.json({ x402Version: 2, resource: { url: req.url }, accepts }, { status: 402 });
        }
        approvedAtPayment = approvalStatus === "countersign";
        paidCount += 1;
        const payment = fromBase64Json<PaymentPayload>(header);
        const chk = await checkCountersign(payment.payload as unknown as CountersignPayload, {
          chainId: 5042002,
          escrow: ESCROW,
          token: TOKEN,
          tokenName: "USDC",
          tokenVersion: "2",
          now: Math.floor(Date.now() / 1000),
        });
        if (!chk.ok) return Response.json({ code: "bad-payment", message: chk.message }, { status: 400 });
        const output = { a: (body.input as { q: string }).q };
        const slip = await makeSlip(payment, body.input, output);
        return new Response(JSON.stringify({ output, slip }), {
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": toBase64Json({
              success: true,
              transaction: slip.settlement.transaction,
              network: "eip155:5042002",
            }),
          },
        });
      }
      return new Response("{}", { status: 404 });
    },
  });
  servers.push(server);
  state.url = `http://127.0.0.1:${server.port}`;
  return state;
}

function run(f: ReturnType<typeof fresh>, hub: BuyHub, over: { envelope?: Envelope; mirror?: boolean } = {}) {
  return buy({
    hub: new HubClient(hub.url),
    offerHash,
    input: { q: "hi" },
    payers: [countersignPayer(agent)],
    envelope: over.envelope ?? envelope(),
    journal: f.journal,
    state: f.state,
    now: Math.floor(Date.now() / 1000),
    known: [TEST_RAIL],
    approvals: "hub",
    account: agent,
    ...(over.mirror !== undefined ? { mirror: over.mirror } : {}),
  });
}

describe("requestApproval", () => {
  test("returns countersign after two polls", async () => {
    let polls = 0;
    const captured: { posted?: Record<string, unknown> } = {};
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "POST") {
          captured.posted = (await req.json()) as Record<string, unknown>;
          return Response.json({ id: "1".repeat(32) }, { status: 201 });
        }
        polls += 1;
        return Response.json({ status: polls < 2 ? "pending" : "countersign" });
      },
    });
    servers.push(server);
    const hub = new HubClient(`http://127.0.0.1:${server.port}`);

    const outcome = await requestApproval({
      hub,
      account: agent,
      offerHash: "0x11",
      title: "A call",
      amount: "1000",
      rail: "escrow",
      terms: { deadline: 1 },
      now: 1_700_000_000,
      timeoutMs: 1_000,
      pollMs: 1,
    });

    expect(outcome).toBe("countersign");
    expect(polls).toBe(2);
    const posted = captured.posted ?? {};
    expect(posted.agent).toBe(agent.address);
    expect(posted.title).toBe("A call");
    const { sig, ...signed } = posted;
    expect(typeof sig).toBe("string");
    const signer = await recoverMessageAddress({ message: canonicalJson(signed), signature: sig as Hex });
    expect(signer).toBe(agent.address);
  });

  test("times out", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "POST") return Response.json({ id: "2".repeat(32) }, { status: 201 });
        return Response.json({ status: "pending" });
      },
    });
    servers.push(server);
    const hub = new HubClient(`http://127.0.0.1:${server.port}`);

    const outcome = await requestApproval({
      hub,
      account: agent,
      offerHash: "0x11",
      title: "A call",
      amount: "1000",
      rail: "escrow",
      terms: {},
      now: 1_700_000_000,
      timeoutMs: 20,
      pollMs: 5,
    });
    expect(outcome).toBe("timeout");
  });
});

describe("buy with hub approvals", () => {
  test("signs only after the human countersigns", async () => {
    const hub = startBuyHub();
    const f = fresh();
    const result = await run(f, hub);

    expect(result.output).toEqual({ a: "hi" });
    expect(hub.approvals).toBe(1);
    expect(hub.approvedAtPayment).toBe(true);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "signed", "released"]);
  });

  test("a decline journals human-declined and never signs", async () => {
    const hub = startBuyHub({ decision: "decline" });
    const f = fresh();
    await expect(run(f, hub)).rejects.toThrow("Held. The human did not countersign this call.");

    expect(hub.approvals).toBe(1);
    expect(hub.paid).toBe(0);
    expect(f.journal.entries()).toHaveLength(1);
    expect(f.journal.entries()[0]?.kind).toBe("refused");
    expect(f.journal.entries()[0]?.reason).toBe("human-declined");
  });

  test("the cap is enforced before any approval request", async () => {
    const hub = startBuyHub();
    const f = fresh();
    await expect(run(f, hub, { envelope: envelope({ cap: "100" }) })).rejects.toThrow(BuyError);

    expect(hub.approvals).toBe(0);
    expect(hub.paid).toBe(0);
    expect(f.journal.entries()).toHaveLength(1);
    expect(f.journal.entries()[0]?.reason).toBe("over-cap");
  });

  test("envelope mirror failures never fail a buy", async () => {
    const hub = startBuyHub({ mirrorStatus: 500 });
    const f = fresh();
    const result = await run(f, hub, { mirror: true });

    expect(result.output).toEqual({ a: "hi" });
    expect(hub.mirrors).toBeGreaterThan(0);
  });

  test("mirror publishes the agent's signed envelope and spend", async () => {
    const hub = startBuyHub({ verifyMirror: true });
    const f = fresh();
    await run(f, hub, { mirror: true });
    expect(hub.mirrors).toBeGreaterThan(0);
  });
});

describe("publishEnvelope", () => {
  test("a rejected mirror returns false instead of throwing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("{}", { status: 500 });
      },
    });
    servers.push(server);
    const spent: EnvelopeSpend = { total: "0", bySeller: {} };

    const ok = await publishEnvelope({
      hub: new HubClient(`http://127.0.0.1:${server.port}`),
      account: agent,
      envelope: envelope({ agent: agent.address }),
      spent,
      now: 1_700_000_000,
    });
    expect(ok).toBe(false);
  });
});
