import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, type Hex } from "viem";
import { canonicalHash, type Envelope, type Offer } from "@countersign/core";
import { BuyError, HubClient, Journal, State, buy } from "../src/index.ts";

const seller = getAddress("0x1111111111111111111111111111111111111111");
const agent = getAddress("0x2222222222222222222222222222222222222222");

const offer: Offer = {
  v: 1,
  seller,
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

const bodies: unknown[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === `/offers/${offerHash}`) {
      return Response.json({ offerHash, offer, online: true, status: "listed" });
    }
    if (req.method === "POST" && url.pathname === `/offers/${offerHash}/call`) {
      bodies.push(await req.json());
      return Response.json({ code: "stop", message: "stop" }, { status: 400 });
    }
    return new Response("no", { status: 404 });
  },
});

const hub = new HubClient(`http://127.0.0.1:${server.port}`);
const savedLineage = process.env.COUNTERSIGN_LINEAGE;

afterEach(() => {
  bodies.length = 0;
  restoreLineage(savedLineage);
});

afterAll(() => {
  restoreLineage(savedLineage);
  server.stop(true);
});

function hash(byte: string): Hex {
  return `0x${byte.repeat(32)}` as Hex;
}

function restoreLineage(value: string | undefined): void {
  if (value === undefined) delete process.env.COUNTERSIGN_LINEAGE;
  else process.env.COUNTERSIGN_LINEAGE = value;
}

function envelope(): Envelope {
  return {
    v: 1,
    agent,
    cap: "1",
    perMerchant: "1",
    allowlist: [],
    revoked: false,
  };
}

function call(lineage?: Hex[]): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "cs-lineage-"));
  return buy({
    hub,
    offerHash,
    input: { q: "hi" },
    payers: [],
    envelope: envelope(),
    journal: new Journal(join(dir, "journal.jsonl")),
    state: new State(dir),
    now: 1_700_000_000,
    ...(lineage !== undefined ? { lineage } : {}),
  });
}

describe("COUNTERSIGN_LINEAGE", () => {
  test("the call body carries the lineage when none was given", async () => {
    const lineage = [hash("aa"), hash("bb")];
    process.env.COUNTERSIGN_LINEAGE = lineage.join(",");
    await expect(call()).rejects.toThrow(BuyError);
    expect(bodies).toEqual([{ input: { q: "hi" }, lineage }]);
  });

  test("invalid entries are dropped and at most 16 remain", async () => {
    const valid = Array.from({ length: 17 }, (_, index) => hash(index.toString(16).padStart(2, "0")));
    process.env.COUNTERSIGN_LINEAGE = ["nope", ...valid, "0xzz"].join(",");
    await expect(call()).rejects.toThrow(BuyError);
    expect(bodies).toEqual([{ input: { q: "hi" }, lineage: valid.slice(0, 16) }]);
  });

  test("an explicit lineage wins", async () => {
    const explicit = [hash("ee")];
    process.env.COUNTERSIGN_LINEAGE = hash("ff");
    await expect(call(explicit)).rejects.toThrow(BuyError);
    expect(bodies).toEqual([{ input: { q: "hi" }, lineage: explicit }]);
  });

  test("omits lineage when the variable is unset", async () => {
    delete process.env.COUNTERSIGN_LINEAGE;
    await expect(call()).rejects.toThrow(BuyError);
    expect(bodies).toEqual([{ input: { q: "hi" } }]);
  });
});
