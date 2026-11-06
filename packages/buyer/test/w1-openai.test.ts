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

// cs-w1 adversarial tests for the OpenAI-compatible endpoint. A failing test here is a blocker.

const seller = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const PRICE = "250000";
const SESSION = "w1-openai-session";
const RAIL: KnownRail = {
  network: "eip155:5042002",
  scheme: "countersign",
  chainId: 5042002,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "https://rpc.testnet.arc.network",
};

function offerTitled(title: string, issuedAt: number): Offer {
  return {
    v: 1,
    seller: seller.address,
    title,
    summary: "",
    adapter: "skill",
    input: { type: "object", required: ["question"], properties: { question: { type: "string" } } },
    output: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
    price: PRICE,
    deadline: 120,
    bond: "0",
    rails: ["escrow"],
    issuedAt,
  };
}
const asked = offerTitled("Asked for", 1);
const other = offerTitled("Chosen by the hub", 2);
const askedHash = canonicalHash(asked);
const otherHash = canonicalHash(other);
const offerOf = (hash: string) => (hash === askedHash ? asked : hash === otherHash ? other : undefined);

interface HubBehaviour {
  /** GET /offers fails, so the endpoint falls back to GET /offers/:hash. */
  listFails?: boolean;
  /** GET /offers/:hash answers this listing whatever hash was asked for. */
  serve?: Hex;
  /** The paid call is processed, then its answer does not arrive whole. */
  loseAnswer?: boolean;
}

function fakeHub(behaviour: HubBehaviour) {
  const paid: string[] = [];
  const listing = (hash: Hex) => ({ offerHash: hash, offer: offerOf(hash), online: true, status: "listed" });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/offers") {
        if (behaviour.listFails) return Response.json({ message: "down" }, { status: 500 });
        return Response.json({ offers: [listing(askedHash), listing(otherHash)] });
      }
      if (req.method === "POST" && url.pathname.endsWith("/call")) {
        const hash = url.pathname.slice("/offers/".length, -"/call".length) as Hex;
        const body = (await req.json()) as { input: unknown };
        const header = req.headers.get(PAYMENT_SIGNATURE_HEADER);
        const extra: CountersignExtra = {
          rail: "escrow", escrow: ESCROW, chainId: 5042002, offerHash: hash, deadlineSeconds: 120, tokenName: "USDC", tokenVersion: "2",
        };
        if (!header) {
          return Response.json(
            {
              x402Version: 2,
              resource: { url: req.url },
              accepts: [{ scheme: "countersign", network: "eip155:5042002", amount: PRICE, asset: TOKEN, payTo: seller.address, maxTimeoutSeconds: 120, extra }],
            },
            { status: 402 },
          );
        }
        const payment = fromBase64Json<PaymentPayload>(header);
        const p = payment.payload as unknown as CountersignPayload;
        paid.push(p.authorization.nonce);
        if (behaviour.loseAnswer) return new Response('{"output": {"answer": "', { status: 200 });
        const output = { answer: String((body.input as { question?: unknown }).question) };
        const slipBody = slipBodyFor(
          {
            jobId: p.authorization.nonce, offerHash: hash, input: body.input, rail: "escrow", network: "eip155:5042002",
            buyer: p.terms.buyer, payTo: seller.address, asset: TOKEN, amount: PRICE, deadline: p.terms.deadline,
            escrow: ESCROW, chainId: 5042002, lineage: [],
          },
          seller.address,
          canonicalHash(body.input),
          canonicalHash(output),
          1000,
        );
        const slip: Slip = {
          body: slipBody,
          hash: slipHash(slipBody),
          sellerSig: await seller.signTypedData(slipTypedData(slipBody)),
          payment,
          settlement: { transaction: `0x${"ab".repeat(32)}`, network: "eip155:5042002" },
        };
        return new Response(JSON.stringify({ output, slip }), {
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": toBase64Json({ success: true, transaction: slip.settlement.transaction, network: "eip155:5042002" }),
          },
        });
      }
      if (req.method === "GET" && url.pathname.startsWith("/offers/")) {
        const hash = (behaviour.serve ?? url.pathname.slice("/offers/".length)) as Hex;
        return offerOf(hash) ? Response.json(listing(hash)) : Response.json({}, { status: 404 });
      }
      return Response.json({}, { status: 404 });
    },
  });
  return { server, paid, hub: new HubClient(`http://127.0.0.1:${server.port}`) };
}

const cleanups: Array<() => unknown> = [];
afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

function envelope(over: Partial<Envelope> = {}): Envelope {
  return { v: 1, agent: buyer.address, cap: "5000000", perMerchant: "5000000", allowlist: [], revoked: false, ...over };
}

/** Starts the endpoint the way `cli.ts openai` does: the envelope comes from the state directory. */
function startLikeTheCli(hub: HubClient, saved: Envelope) {
  const dir = mkdtempSync(join(tmpdir(), "w1-openai-"));
  const state = new State(dir);
  state.saveEnvelope(saved);
  const journal = new Journal(state.journalPath);
  const handle: OpenAIServerHandle = startOpenAIServer({
    hub,
    account: buyer,
    envelope: state.loadEnvelope(),
    journal,
    state,
    port: 0,
    token: SESSION,
    now: () => Math.floor(Date.now() / 1000),
    payers: [countersignPayer(buyer)],
    known: [RAIL],
  });
  cleanups.push(() => handle.stop());
  return { state, journal, client: new OpenAI({ baseURL: `${handle.url}/v1`, apiKey: SESSION }) };
}

const signedOf = (journal: Journal) => journal.entries().filter((e) => e.kind === "signed").length;

describe("W1 B18: a running endpoint keeps spending after the human revokes", () => {
  test("envelope set --revoke stops the next completion", async () => {
    const fake = fakeHub({});
    cleanups.push(() => fake.server.stop(true));
    const run = startLikeTheCli(fake.hub, envelope());

    // The human revokes while the endpoint runs, as `envelope set --revoke` does.
    run.state.saveEnvelope(envelope({ revoked: true }));

    const outcome = await run.client.chat.completions
      .create({ model: askedHash, messages: [{ role: "user", content: "hello" }] })
      .then(() => "paid", (e: unknown) => (e instanceof APIError ? e.status : "error"));
    expect(outcome).toBe(403);
    expect(signedOf(run.journal)).toBe(0);
  });
});

describe("W1 B19: in the fallback lookup the hub chooses which offer is bought", () => {
  test("a hub whose list fails cannot answer another offer for the model asked for", async () => {
    const fake = fakeHub({ listFails: true, serve: otherHash });
    cleanups.push(() => fake.server.stop(true));
    const run = startLikeTheCli(fake.hub, envelope());

    await run.client.chat.completions
      .create({ model: askedHash, messages: [{ role: "user", content: "hello" }] })
      .catch(() => undefined);
    // Nothing may be paid for an offer other than the one the client named.
    const boughtOther = run.journal.entries().some((e) => e.offerHash?.toLowerCase() === otherHash.toLowerCase());
    expect(boughtOther).toBe(false);
  });
});

describe("W1 B20: a completion whose answer is lost is paid again by the client's retries", () => {
  test("one completion signs one payment, whatever the OpenAI client retries", async () => {
    const fake = fakeHub({ loseAnswer: true });
    cleanups.push(() => fake.server.stop(true));
    const run = startLikeTheCli(fake.hub, envelope());
    // The official client, with its default retries (2), as an agent would use it.
    const client = new OpenAI({ baseURL: run.client.baseURL, apiKey: SESSION, timeout: 15_000 });

    await client.chat.completions
      .create({ model: askedHash, messages: [{ role: "user", content: "hello" }] })
      .catch(() => undefined);
    expect(fake.paid.length).toBe(1);
    expect(signedOf(run.journal)).toBe(1);
  });
});
