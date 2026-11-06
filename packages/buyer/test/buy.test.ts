import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import {
  PAYMENT_SIGNATURE_HEADER,
  canonicalHash,
  checkCountersign,
  fromBase64Json,
  slipBodyFor,
  slipHash,
  slipTypedData,
  toBase64Json,
  type CountersignExtra,
  type CountersignPayload,
  type Envelope,
  type Offer,
  type PaymentPayload,
  type Slip,
} from "@countersign/core";
import { BuyError, HubClient, Journal, State, buy, countersignPayer, resume } from "../src/index.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const otherKey = privateKeyToAccount(generatePrivateKey());
const buyerAcct = privateKeyToAccount(generatePrivateKey());
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";

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
    scheme: "countersign",
    network: "eip155:5042002",
    amount: PRICE,
    asset: TOKEN,
    payTo: seller.address,
    maxTimeoutSeconds: 120,
    extra,
  },
];

let mode: "ok" | "wrongsigner" | "moved" = "ok";
let unpaid = 0;
let paid = 0;
const jobs = new Map<string, { status: string; slipHash?: Hex }>();
const slips = new Map<string, Slip>();

async function makeSlip(payment: PaymentPayload, input: unknown, output: unknown, signer: typeof seller): Promise<Slip> {
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
  const sellerSig = await signer.signTypedData(slipTypedData(body));
  return {
    body,
    hash: slipHash(body),
    sellerSig,
    payment,
    settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
  };
}

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const listing = { offerHash, offer, online: true, status: "listed" };
    if (req.method === "GET" && url.pathname === `/offers/${offerHash}`) return Response.json(listing);
    if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const j = jobs.get(url.pathname.slice(6));
      return j ? Response.json({ jobId: url.pathname.slice(6), offerHash, rail: "escrow", status: j.status, deadline: 0, closeTx: "0xcc", slipHash: j.slipHash }) : new Response("{}", { status: 404 });
    }
    if (req.method === "GET" && url.pathname.startsWith("/slips/")) {
      const s = slips.get(url.pathname.slice(7));
      return s ? Response.json(s) : new Response("{}", { status: 404 });
    }
    if (req.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      const body = (await req.json()) as { input: unknown };
      const h = req.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!h) {
        unpaid++;
        return Response.json({ x402Version: 2, resource: { url: req.url }, accepts }, { status: 402 });
      }
      paid++;
      if (mode === "moved") return Response.json({ error: "Refused. The price moved after you signed." }, { status: 402 });
      const payment = fromBase64Json<PaymentPayload>(h);
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
      const slip = await makeSlip(payment, body.input, output, mode === "wrongsigner" ? otherKey : seller);
      return new Response(JSON.stringify({ output, slip }), {
        headers: { "content-type": "application/json", "PAYMENT-RESPONSE": toBase64Json({ success: true, transaction: slip.settlement.transaction, network: "eip155:5042002" }) },
      });
    }
    return new Response("{}", { status: 404 });
  },
});

afterAll(() => server.stop(true));

const hub = new HubClient(`http://127.0.0.1:${server.port}`);
const env = (over: Partial<Envelope> = {}): Envelope => ({
  v: 1,
  agent: buyerAcct.address,
  cap: "5000000",
  perMerchant: "5000000",
  allowlist: [],
  revoked: false,
  ...over,
});

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "cs-buyer-"));
  const state = new State(dir);
  return { state, journal: new Journal(state.journalPath) };
}
const run = (f: ReturnType<typeof fresh>, over: { envelope?: Envelope; input?: unknown; approve?: boolean } = {}) =>
  buy({
    hub,
    offerHash,
    input: over.input ?? { q: "hi" },
    payers: [countersignPayer(buyerAcct)],
    envelope: over.envelope ?? env(),
    journal: f.journal,
    state: f.state,
    now: Math.floor(Date.now() / 1000),
    approve: over.approve,
  });

beforeAll(() => {
  mode = "ok";
});

describe("buy", () => {
  test("happy path", async () => {
    mode = "ok";
    const f = fresh();
    const res = await run(f);
    expect(res.output).toEqual({ a: "hi" });
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "released"]);
    expect(existsSync(f.state.slipPath(res.slip.hash))).toBe(true);
    expect(f.journal.spend().total).toBe(PRICE);
  });

  test("envelope cap refuses without sending a payment", async () => {
    mode = "ok";
    const f = fresh();
    const before = paid;
    await expect(run(f, { envelope: env({ cap: "100" }) })).rejects.toThrow(BuyError);
    expect(paid).toBe(before);
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["refused"]);
  });

  test("askAbove holds, approve goes through", async () => {
    mode = "ok";
    const f = fresh();
    const e = env({ askAbove: "100000" });
    await expect(run(f, { envelope: e })).rejects.toThrow("Held.");
    expect(f.journal.entries()[0]?.reason).toBe("held");
    const res = await run(f, { envelope: e, approve: true });
    expect(res.output).toEqual({ a: "hi" });
  });

  test("bad input is refused before any 402 request", async () => {
    const f = fresh();
    const before = unpaid;
    await expect(run(f, { input: { q: 5 } })).rejects.toThrow("input does not match");
    expect(unpaid).toBe(before);
    expect(f.journal.entries()).toEqual([]);
  });

  test("slip signed by another key does not verify", async () => {
    mode = "wrongsigner";
    const f = fresh();
    await expect(run(f)).rejects.toThrow("does not verify");
    const kinds = f.journal.entries().map((e) => e.kind);
    expect(kinds).toEqual(["countersigned", "failed"]);
    expect(f.journal.entries()[1]?.reason).toBe("bad-slip");
  });

  test("a 402 with error on the paid call carries its message", async () => {
    mode = "moved";
    const f = fresh();
    await expect(run(f)).rejects.toThrow("Refused. The price moved after you signed.");
    expect(f.journal.entries().map((e) => e.kind)).toEqual(["countersigned", "failed"]);
  });
});

describe("resume and journal", () => {
  test("resume appends released and saves the slip", async () => {
    mode = "ok";
    const donor = fresh();
    const res = await run(donor);
    const jobId = res.slip.body.jobId;
    slips.set(res.slip.hash, res.slip);
    jobs.set(jobId, { status: "released", slipHash: res.slip.hash });
    const f = fresh();
    f.journal.append({ at: 1, kind: "countersigned", offerHash, seller: seller.address, amount: PRICE, rail: "escrow", jobId });
    expect(f.journal.open().length).toBe(1);
    const out = await resume({ hub, journal: f.journal, state: f.state, now: 2 });
    expect(out[0]?.appended).toBe("released");
    expect(f.journal.entries().at(-1)?.kind).toBe("released");
    expect(existsSync(f.state.slipPath(res.slip.hash))).toBe(true);
    expect(f.journal.open().length).toBe(0);
  });

  test("spend subtracts refunded jobs", () => {
    const f = fresh();
    const base = { offerHash, seller: seller.address, amount: "100" };
    f.journal.append({ at: 1, kind: "countersigned", ...base, jobId: "0x01" });
    f.journal.append({ at: 1, kind: "countersigned", ...base, jobId: "0x02" });
    expect(f.journal.spend().total).toBe("200");
    f.journal.append({ at: 2, kind: "refunded", ...base, jobId: "0x01" });
    expect(f.journal.spend().total).toBe("100");
    expect(f.journal.spend().bySeller[seller.address.toLowerCase()]).toBe("100");
  });
});
