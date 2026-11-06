import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalHash, type Envelope, type Offer } from "@countersign/core";
import { HubClient, Journal, State, buy, countersignPayer } from "../src/index.ts";

const seller = privateKeyToAccount(generatePrivateKey());
const agent = privateKeyToAccount(generatePrivateKey());

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "Echo",
  summary: "echoes",
  adapter: "skill",
  input: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
  output: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
  price: "250000",
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};
const offerHash = canonicalHash(offer);

const envelope: Envelope = {
  v: 1,
  agent: agent.address,
  cap: "5000000",
  perMerchant: "5000000",
  allowlist: [],
  revoked: false,
};

const seen: Array<string | null> = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `/offers/${offerHash}`) {
      return Response.json({ offerHash, offer, online: true, status: "listed" });
    }
    if (req.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      seen.push(req.headers.get("x-countersign-agent"));
      return Response.json(
        { x402Version: 2, resource: { url: req.url }, accepts: [] },
        { status: 402 },
      );
    }
    return new Response("{}", { status: 404 });
  },
});

afterAll(() => server.stop(true));

describe("the agent header", () => {
  test("HubClient.call sends X-Countersign-Agent only when an agent is given", async () => {
    const calls: Headers[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(new Headers(init?.headers));
      return new Response(
        JSON.stringify({ x402Version: 2, resource: { url: String(input) }, accepts: [] }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const hub = new HubClient("http://hub.test", fetchImpl);

    await hub.call("0xabc", { q: "hi" }, undefined, undefined, agent.address);
    await hub.call("0xabc", { q: "hi" });

    expect(calls[0]?.get("x-countersign-agent")).toBe(agent.address);
    expect(calls[1]?.get("x-countersign-agent")).toBeNull();
  });

  test("buy names the agent's address on its first call", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-agent-header-"));
    const state = new State(dir);
    const journal = new Journal(state.journalPath);

    await expect(
      buy({
        hub: new HubClient(`http://127.0.0.1:${server.port}`),
        offerHash,
        input: { q: "hi" },
        payers: [countersignPayer(agent)],
        envelope,
        journal,
        state,
        now: 1,
        known: [],
      }),
    ).rejects.toThrow("No rail here that this agent can pay.");

    expect(seen[0]).toBe(agent.address);
  });
});
