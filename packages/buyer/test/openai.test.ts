import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI, { APIError } from "openai";
import { privateKeyToAccount } from "viem/accounts";
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
import { HubClient, Journal, State, countersignPayer } from "../src/index.ts";
import type { KnownRail } from "../src/index.ts";
import { startOpenAIServer, type OpenAIServerHandle } from "../src/openai/server.ts";

const seller = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const SESSION_TOKEN = "openai-test-session-token";

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

const questionOffer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Ask",
  summary: "answers one question",
  adapter: "skill",
  input: {
    type: "object",
    required: ["question"],
    properties: { question: { type: "string" } },
  },
  output: {
    type: "object",
    required: ["answer"],
    properties: { answer: { type: "string" } },
  },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};

const pairOffer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Pair",
  summary: "needs two fields",
  adapter: "skill",
  input: {
    type: "object",
    required: ["left", "right"],
    properties: { left: { type: "string" }, right: { type: "string" } },
  },
  output: {
    type: "object",
    required: ["sum"],
    properties: { sum: { type: "string" } },
  },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 2,
};

const questionHash = canonicalHash(questionOffer);
const pairHash = canonicalHash(pairOffer);

function extraFor(offerHash: Hex): CountersignExtra {
  return {
    rail: "escrow",
    escrow: ESCROW,
    chainId: 5042002,
    offerHash,
    deadlineSeconds: 120,
    tokenName: "USDC",
    tokenVersion: "2",
  };
}

function acceptsFor(offerHash: Hex) {
  return [
    {
      scheme: "countersign",
      network: "eip155:5042002",
      amount: PRICE,
      asset: TOKEN,
      payTo: seller.address,
      maxTimeoutSeconds: 120,
      extra: extraFor(offerHash),
    },
  ];
}

let lastSlip: Slip | undefined;

async function makeSlip(
  payment: PaymentPayload,
  offerHash: Hex,
  input: unknown,
  output: unknown,
): Promise<Slip> {
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
  const slip: Slip = {
    body,
    hash: slipHash(body),
    sellerSig,
    payment,
    settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
  };
  lastSlip = slip;
  return slip;
}

function outputFor(offerHash: Hex, input: unknown): unknown {
  const body = input as Record<string, unknown>;
  if (offerHash === questionHash) return { answer: body.question };
  return { sum: `${String(body.left)}${String(body.right)}` };
}

const hubServer = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const listings = [
      { offerHash: questionHash, offer: questionOffer, online: true, status: "listed" },
      { offerHash: pairHash, offer: pairOffer, online: true, status: "listed" },
      { offerHash: canonicalHash({ ...pairOffer, title: "Gone" }), offer: { ...pairOffer, title: "Gone" }, online: false, status: "delisted" },
    ];
    if (req.method === "GET" && url.pathname === "/offers") {
      return Response.json({ offers: listings });
    }
    const callPrefix = "/offers/";
    if (req.method === "POST" && url.pathname.startsWith(callPrefix) && url.pathname.endsWith("/call")) {
      const hash = url.pathname.slice(callPrefix.length, -"/call".length);
      const offer = hash === questionHash ? questionOffer : hash === pairHash ? pairOffer : undefined;
      if (!offer) return Response.json({ code: "not-found", message: "no such offer" }, { status: 404 });
      const body = (await req.json()) as { input: unknown };
      const header = req.headers.get(PAYMENT_SIGNATURE_HEADER);
      if (!header) {
        return Response.json(
          { x402Version: 2, resource: { url: req.url }, accepts: acceptsFor(hash as Hex) },
          { status: 402 },
        );
      }
      const payment = fromBase64Json<PaymentPayload>(header);
      const check = await checkCountersign(payment.payload as unknown as CountersignPayload, {
        chainId: 5042002,
        escrow: ESCROW,
        token: TOKEN,
        tokenName: "USDC",
        tokenVersion: "2",
        now: Math.floor(Date.now() / 1000),
      });
      if (!check.ok) return Response.json({ code: "bad-payment", message: check.message }, { status: 400 });
      const output = outputFor(hash as Hex, body.input);
      const slip = await makeSlip(payment, hash as Hex, body.input, output);
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
    if (req.method === "GET" && url.pathname.startsWith("/offers/")) {
      const hash = url.pathname.slice("/offers/".length);
      const listing = listings.find((item) => item.offerHash === hash);
      return listing ? Response.json(listing) : Response.json({}, { status: 404 });
    }
    return Response.json({}, { status: 404 });
  },
});

const hub = new HubClient(`http://127.0.0.1:${hubServer.port}`);
const handles: OpenAIServerHandle[] = [];

afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.stop()));
  await hubServer.stop(true);
});

function envelope(over: Partial<Envelope> = {}): Envelope {
  return {
    v: 1,
    agent: buyer.address,
    cap: "5000000",
    perMerchant: "5000000",
    allowlist: [],
    revoked: false,
    ...over,
  };
}

interface Running {
  client: OpenAI;
  handle: OpenAIServerHandle;
  journal: Journal;
}

function start(over: Partial<Envelope> = {}): Running {
  const dir = mkdtempSync(join(tmpdir(), "cs-openai-"));
  const state = new State(dir);
  const journal = new Journal(state.journalPath);
  const handle = startOpenAIServer({
    hub,
    account: buyer,
    envelope: envelope(over),
    journal,
    state,
    port: 0,
    token: SESSION_TOKEN,
    now: () => Math.floor(Date.now() / 1000),
    payers: [countersignPayer(buyer)],
    known: [TEST_RAIL],
  });
  handles.push(handle);
  return { client: new OpenAI({ baseURL: `${handle.url}/v1`, apiKey: SESSION_TOKEN }), handle, journal };
}

interface Countersign {
  slipHash: Hex;
  tx: string;
  explorer: string | null;
  amount: string;
  rail: string;
}

async function rejection(promise: Promise<unknown>): Promise<APIError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof APIError) return e;
    throw e;
  }
  throw new Error("expected the request to fail");
}

describe("openai server", () => {
  test("models.list returns the listed, online offers", async () => {
    const run = start();
    const page = await run.client.models.list();
    const ids = page.data.map((model) => model.id);
    expect(ids).toContain(questionHash);
    expect(ids).toContain(pairHash);
    const model = page.data.find((item) => item.id === questionHash);
    expect(model?.object).toBe("model");
    expect(model?.created).toBe(questionOffer.issuedAt);
    expect(model?.owned_by).toBe(seller.address);
  });

  test("a chat completion buys the offer and carries the countersignature", async () => {
    const run = start();
    const answer = await run.client.chat.completions.create({
      model: questionHash,
      messages: [{ role: "user", content: "what is arc?" }],
    });
    const content = answer.choices[0]?.message.content;
    expect(typeof content).toBe("string");
    expect(JSON.parse(content as string)).toEqual({ answer: "what is arc?" });
    const countersign = (answer as unknown as { countersign: Countersign }).countersign;
    const slip = lastSlip;
    if (slip === undefined) throw new Error("the fake hub minted no slip");
    expect(countersign.slipHash).toBe(slip.hash);
    expect(countersign.tx).toBe(slip.settlement.transaction);
    expect(countersign.amount).toBe(PRICE);
    expect(countersign.rail).toBe("escrow");
    expect(countersign.explorer).toBeNull();
    expect(answer.id).toBe(`chatcmpl-${slip.hash.slice(2, 26)}`);
    expect(run.journal.entries().map((entry) => entry.kind)).toEqual([
      "countersigned",
      "signed",
      "released",
    ]);
  });

  test("an envelope cap below the price is a 403 envelope_refused", async () => {
    const run = start({ cap: "100" });
    const error = await rejection(
      run.client.chat.completions.create({
        model: questionHash,
        messages: [{ role: "user", content: "what is arc?" }],
      }),
    );
    expect(error.status).toBe(403);
    expect(error.type).toBe("envelope_refused");
  });

  test("input that fits no schema is a 400 bad_input", async () => {
    const run = start();
    const error = await rejection(
      run.client.chat.completions.create({
        model: pairHash,
        messages: [{ role: "user", content: "not json at all" }],
      }),
    );
    expect(error.status).toBe(400);
    expect(error.code).toBe("bad_input");
    expect(error.message).toContain("left, right");
  });

  test("a wrong token is a 401", async () => {
    const run = start();
    const client = new OpenAI({ baseURL: `${run.handle.url}/v1`, apiKey: "wrong-token" });
    const error = await rejection(client.models.list());
    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
  });

  test("a streamed completion yields the content once and ends", async () => {
    const run = start();
    const stream = await run.client.chat.completions.create({
      model: questionHash,
      messages: [{ role: "user", content: "what is arc?" }],
      stream: true,
    });
    let content = "";
    let chunks = 0;
    for await (const chunk of stream) {
      chunks++;
      content += chunk.choices[0]?.delta?.content ?? "";
    }
    expect(chunks).toBe(1);
    expect(JSON.parse(content)).toEqual({ answer: "what is arc?" });
  });
});
