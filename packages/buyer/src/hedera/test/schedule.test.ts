import { describe, expect, test } from "bun:test";
import { canonicalJson, offerHash, type Offer } from "@countersign/core";
import { HEDERA_TESTNET, offerMemo, toMirrorTxId, USDC_TESTNET } from "@countersign/rail/hedera";
import { readEntries, reconcile, type LoggedEntry, type SpendEntry } from "../spendlog.ts";

const TOPIC = "0.0.11337070";
const AGENT = "0.0.11337064";
const PAYEE = "0.0.11337065";
const SELLER = "0x00000000000000000000000000000000000000a1";
const SCHEDULE = "0.0.500";

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
    tx: "0.0.11337064@1793957000.000000001",
    schedule: SCHEDULE,
    total: "10000",
    cap: "1000000",
    at: 1793957001,
    ...over,
  };
}

function b64(value: string | object): string {
  return Buffer.from(typeof value === "string" ? value : canonicalJson(value)).toString("base64");
}

function execution(id: string, over: { credit?: bigint; debit?: bigint; memo?: string } = {}) {
  return {
    transaction_id: toMirrorTxId(id),
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensus_timestamp: "1793958001.000000001",
    memo_base64: b64(over.memo ?? offerMemo(OFFER)),
    transfers: [],
    token_transfers: [
      { token_id: USDC_TESTNET, account: AGENT, amount: Number(-(over.debit ?? 10000n)) },
      { token_id: USDC_TESTNET, account: PAYEE, amount: Number(over.credit ?? 10000n) },
    ],
  };
}

function auditMirror(record: object | null) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/v1/transactions?account.id=")) {
      return Response.json({ transactions: [], links: { next: null } });
    }
    return record ? Response.json({ transactions: [record] }) : new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, urls };
}

function logged(sequence: number, value: SpendEntry): LoggedEntry {
  return { sequence, consensusAt: `17939570${sequence}.000000001`, entry: value };
}

describe("scheduled spends in the log", () => {
  test("readEntries keeps the schedule id on a scheduled spend", async () => {
    const scheduled = entry();
    const bad = { ...entry({ tx: "0.0.11337064@1793957001.000000001" }), schedule: 7 };
    const fake = (async () =>
      Response.json({
        messages: [
          { sequence_number: 1, consensus_timestamp: "1793957001.000000001", message: b64(scheduled) },
          { sequence_number: 2, consensus_timestamp: "1793957002.000000001", message: b64(bad) },
        ],
        links: { next: null },
      })) as unknown as typeof globalThis.fetch;

    const entries = await readEntries(TOPIC, { base: "http://mirror.test", fetch: fake });
    expect(entries.map((e) => e.sequence)).toEqual([1]);
    expect(entries[0]!.entry.schedule).toBe(SCHEDULE);
    expect(entries[0]!.entry.tx).toBe(scheduled.tx);
  });

  test("reconcile reads a scheduled entry's execution with ?scheduled=true", async () => {
    const id = "0.0.11337064@1793958000.000000001";
    const mirror = auditMirror(execution(id));
    const entries = [logged(1, entry())];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.matched.map((e) => e.sequence)).toEqual([1]);
    expect(result.unbacked).toEqual([]);
    expect(result.unlogged).toEqual([]);
    expect(mirror.urls.some((u) => u.includes("/api/v1/transactions/0.0.11337064-1793957000-000000001?scheduled=true"))).toBe(
      true,
    );
  });

  test("reconcile flags a scheduled execution whose credit differs", async () => {
    const id = "0.0.11337064@1793958000.000000001";
    const mirror = auditMirror(execution(id, { credit: 9999n }));
    const entries = [logged(1, entry())];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.matched).toEqual([]);
    expect(result.unbacked.map((u) => u.why)).toEqual(["payee credit differs"]);
  });

  test("reconcile flags a scheduled entry whose execution is not on the mirror", async () => {
    const mirror = auditMirror(null);
    const entries = [logged(1, entry())];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.unbacked.map((u) => u.why)).toEqual(["scheduled execution not found"]);
  });

  test("an unscheduled entry is still read without the scheduled flag", async () => {
    const id = "0.0.9185802@1793957000.000000001";
    const mirror = auditMirror(execution(id));
    const entries = [logged(1, entry({ tx: id, schedule: undefined }))];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.matched.map((e) => e.sequence)).toEqual([1]);
    expect(mirror.urls.some((u) => u.includes("?scheduled=true"))).toBe(false);
  });
});
