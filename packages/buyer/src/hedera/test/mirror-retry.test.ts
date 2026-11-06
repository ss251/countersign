import { describe, expect, test } from "bun:test";
import { offerHash, type Offer } from "@countersign/core";
import { HEDERA_TESTNET, offerMemo, toMirrorTxId, USDC_TESTNET } from "@countersign/rail/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createHederaAgent, RELEASE_MARGIN_SECONDS, type ScheduleHold } from "../agent.ts";
import { readEntries, reconcile, type SpendEntry } from "../spendlog.ts";

const TOPIC = "0.0.11337070";
const AGENT = "0.0.11337064";
const PAYEE = "0.0.11337065";
const SELLER = "0x00000000000000000000000000000000000000a1";
const SCHEDULE = "0.0.500";
const TX = "0.0.9185802@1793957000.000000001";
const NOW = 1793957000;
const BASE = "http://mirror.test";

function offer(over: Partial<Offer> = {}): Offer {
  return {
    v: 1,
    seller: SELLER,
    title: "Hedera transfer builder",
    summary: "Builds an unsigned HBAR transfer for the caller to sign.",
    adapter: "mcp",
    input: { type: "object" },
    output: { type: "object" },
    price: "10000",
    deadline: 60,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: PAYEE },
    issuedAt: 1793957000,
    ...over,
  };
}

const OFFER = offerHash(offer());

function b64(value: string | object): string {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64");
}

function entry(over: Partial<SpendEntry> = {}): SpendEntry {
  return {
    v: 1,
    kind: "spend",
    rail: "hedera",
    network: HEDERA_TESTNET,
    offerHash: OFFER,
    seller: SELLER,
    payTo: PAYEE,
    asset: USDC_TESTNET,
    amount: "10000",
    tx: TX,
    total: "10000",
    cap: "1000000",
    at: NOW,
    ...over,
  };
}

function mirrorTransaction(id: string) {
  return {
    transaction_id: toMirrorTxId(id),
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensus_timestamp: "1793958001.000000001",
    memo_base64: b64(offerMemo(OFFER)),
    transfers: [],
    token_transfers: [
      { token_id: USDC_TESTNET, account: AGENT, amount: -10000 },
      { token_id: USDC_TESTNET, account: PAYEE, amount: 10000 },
    ],
  };
}

describe("readEntries rides out a mirror blip on every page", () => {
  test("two pages whose first attempts answer 502 return both entries", async () => {
    const first = entry({ kind: "refused", tx: undefined, reason: "over-cap", total: "0" });
    const second = entry({ tx: "0.0.9185802@1793957001.000000001" });
    const attempts = new Map<string, number>();
    let calls = 0;
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls++;
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      if (attempt === 1) return new Response(null, { status: 502 });
      if (url.includes("sequencenumber=gt:1")) {
        return Response.json({
          messages: [{ sequence_number: 2, consensus_timestamp: "1793957002.000000001", message: b64(second) }],
          links: { next: null },
        });
      }
      return Response.json({
        messages: [{ sequence_number: 1, consensus_timestamp: "1793957001.000000001", message: b64(first) }],
        links: { next: `/api/v1/topics/${TOPIC}/messages?order=asc&limit=100&sequencenumber=gt:1` },
      });
    }) as unknown as typeof globalThis.fetch;

    const entries = await readEntries(TOPIC, { base: BASE, fetch, retryDelaysMs: [0] });

    expect(entries.map((e) => e.sequence)).toEqual([1, 2]);
    expect(calls).toBe(4);
  });

  test("502 every time rejects with the topic status after four calls", async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(null, { status: 502 });
    }) as unknown as typeof globalThis.fetch;

    const error = await readEntries(TOPIC, { base: BASE, fetch, retryDelaysMs: [0, 0, 0] }).catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).toBe(`mirror topic ${TOPIC} -> 502`);
    expect(calls).toBe(4);
  });
});

describe("reconcile rides out a mirror blip", () => {
  test("a 503 on the transactions page gives the same result as no blip", async () => {
    const entries = [{ sequence: 1, consensusAt: "1793957000.000000001", entry: entry() }];

    function mirror(blip: boolean) {
      let transactionPages = 0;
      const fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/v1/transactions?account.id=")) {
          transactionPages++;
          if (blip && transactionPages === 1) return new Response(null, { status: 503 });
          return Response.json({
            transactions: [
              {
                transaction_id: toMirrorTxId(TX),
                result: "SUCCESS",
                token_transfers: [{ token_id: USDC_TESTNET, account: AGENT, amount: -10000 }],
              },
            ],
            links: { next: null },
          });
        }
        return Response.json({ transactions: [mirrorTransaction(TX)] });
      }) as unknown as typeof globalThis.fetch;
      return { fetch, transactionPages: () => transactionPages };
    }

    const clean = mirror(false);
    const blipped = mirror(true);
    const expected = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: BASE,
      fetch: clean.fetch,
      since: "1793957000.000000001",
    });
    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: BASE,
      fetch: blipped.fetch,
      retryDelaysMs: [0],
      since: "1793957000.000000001",
    });

    expect(result).toEqual(expected);
    expect(blipped.transactionPages()).toBe(2);
  });
});

const payer = { accountId: AGENT, key: PrivateKey.generateECDSA() };

const HOLD: ScheduleHold = {
  scheduleId: SCHEDULE,
  createTxId: TX,
  offerHash: OFFER,
  seller: SELLER,
  payTo: PAYEE,
  asset: USDC_TESTNET,
  amount: "10000",
};

function record(expirationTime: string) {
  return {
    schedule_id: SCHEDULE,
    creator_account_id: AGENT,
    payer_account_id: AGENT,
    memo: "",
    executed_timestamp: null,
    expiration_time: expirationTime,
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
  };
}

function agentFor(expirationTime: string, entries: SpendEntry[]) {
  const fetch = (async () => Response.json(record(expirationTime))) as unknown as typeof globalThis.fetch;
  return createHederaAgent({
    hub: "http://127.0.0.1:0",
    payer,
    envelope: {
      v: 1,
      agent: "0x00000000000000000000000000000000000000b2",
      cap: "1000000",
      perMerchant: "500000",
      allowlist: [],
      revoked: false,
    },
    topicId: TOPIC,
    spent: { total: "10000", bySeller: { [SELLER]: "10000" } },
    appendLog: async (value) => {
      entries.push(value);
      return { sequence: entries.length };
    },
    mirror: { base: BASE, fetch },
    now: () => NOW,
  });
}

describe("releaseExpired parses an ISO expiration", () => {
  test("an ISO expiration past the margin releases", async () => {
    const entries: SpendEntry[] = [];
    const agent = agentFor(new Date((NOW - RELEASE_MARGIN_SECONDS - 1) * 1000).toISOString(), entries);

    expect(await agent.releaseExpired(HOLD)).toBe("released");
    expect(entries.map((e) => e.kind)).toEqual(["expired"]);
  });

  test("an ISO expiration inside the margin stays pending", async () => {
    const entries: SpendEntry[] = [];
    const agent = agentFor(new Date((NOW - 30) * 1000).toISOString(), entries);

    expect(await agent.releaseExpired(HOLD)).toBe("pending");
    expect(entries).toEqual([]);
  });
});
