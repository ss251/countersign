import { describe, expect, test } from "bun:test";
import {
  canonicalJson,
  offerHash,
  type Offer,
} from "@countersign/core";
import { HEDERA_TESTNET, offerMemo, toMirrorTxId, toSdkTxId, USDC_TESTNET } from "@countersign/rail/hedera";
import { readEntries, reconcile, type SpendEntry } from "../spendlog.ts";

const TOPIC = "0.0.11337070";
const AGENT = "0.0.11337064";
const PAYEE = "0.0.11337065";
const SELLER = "0x00000000000000000000000000000000000000a1";

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
    tx: "0.0.9185802@1793957000.000000001",
    total: "10000",
    cap: "1000000",
    at: 1793957001,
    ...over,
  };
}

function b64(value: string | object): string {
  return Buffer.from(typeof value === "string" ? value : canonicalJson(value)).toString("base64");
}

function logged(sequence: number, value: SpendEntry): { sequence: number; consensusAt: string; entry: SpendEntry } {
  return { sequence, consensusAt: `17939570${sequence}.000000001`, entry: value };
}

function mirrorTransaction(id: string, result: string, over: { credit?: bigint; debit?: bigint; memo?: string } = {}) {
  return {
    transaction_id: toMirrorTxId(id),
    result,
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

describe("spend log", () => {
  test("readEntries follows links.next and skips messages that are not spend entries", async () => {
    const urls: string[] = [];
    const first = entry({ tx: "0.0.9185802@1793957000.000000001" });
    const second = entry({ tx: "0.0.9185802@1793957001.000000001" });
    const refused = entry({ kind: "refused", reason: "over-cap", tx: undefined });
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("sequencenumber=gt:4")) {
        return Response.json({
          messages: [
            { sequence_number: 5, consensus_timestamp: "1793957005.000000001", message: b64(second) },
            { sequence_number: 6, consensus_timestamp: "1793957006.000000001", message: b64(refused) },
          ],
          links: { next: null },
        });
      }
      return Response.json({
        messages: [
          { sequence_number: 1, consensus_timestamp: "1793957001.000000001", message: b64(first) },
          { sequence_number: 2, consensus_timestamp: "1793957002.000000001", message: b64("not json") },
          { sequence_number: 3, consensus_timestamp: "1793957003.000000001", message: b64({ v: 1, kind: "spend", rail: "eip155" }) },
          { sequence_number: 4, consensus_timestamp: "1793957004.000000001", message: b64({ v: 1, kind: "spend", rail: "hedera" }) },
        ],
        links: { next: `/api/v1/topics/${TOPIC}/messages?order=asc&limit=100&sequencenumber=gt:4` },
      });
    }) as unknown as typeof fetch;

    const entries = await readEntries(TOPIC, { base: "http://mirror.test", fetch: fake });
    expect(entries.map((e) => e.sequence)).toEqual([1, 5, 6]);
    expect(entries.map((e) => e.entry.kind)).toEqual(["spend", "spend", "refused"]);
    expect(entries[0]!.entry.tx).toBe(first.tx);
    expect(entries[1]!.entry.tx).toBe(second.tx);
    expect(urls).toEqual([
      `http://mirror.test/api/v1/topics/${TOPIC}/messages?order=asc&limit=100`,
      `http://mirror.test/api/v1/topics/${TOPIC}/messages?order=asc&limit=100&sequencenumber=gt:4`,
    ]);
  });

  test("reconcile separates matched, unbacked and unlogged spends", async () => {
    const otherOffer = offerHash(offer({ title: "another offer" }));
    const matchedTx = "0.0.9185802@1793957000.000000001";
    const missingTx = "0.0.9185802@1793957001.000000001";
    const failedTx = "0.0.9185802@1793957002.000000001";
    const shortTx = "0.0.9185802@1793957003.000000001";
    const debitTx = "0.0.9185802@1793957004.000000001";
    const memoedTx = "0.0.9185802@1793957005.000000001";
    const unloggedTx = "0.0.9185802@1793958000.000000001";

    const entries = [
      { sequence: 1, consensusAt: "1793957000.000000001", entry: entry({ tx: matchedTx }) },
      { sequence: 2, consensusAt: "1793957001.000000001", entry: entry({ tx: missingTx }) },
      { sequence: 3, consensusAt: "1793957002.000000001", entry: entry({ tx: failedTx }) },
      { sequence: 4, consensusAt: "1793957003.000000001", entry: entry({ tx: shortTx }) },
      { sequence: 5, consensusAt: "1793957004.000000001", entry: entry({ tx: debitTx }) },
      { sequence: 6, consensusAt: "1793957005.000000001", entry: entry({ tx: memoedTx }) },
    ];

    const byId = new Map<string, object>([
      [toMirrorTxId(matchedTx), mirrorTransaction(matchedTx, "SUCCESS")],
      [toMirrorTxId(failedTx), mirrorTransaction(failedTx, "INVALID_SIGNATURE")],
      [toMirrorTxId(shortTx), mirrorTransaction(shortTx, "SUCCESS", { credit: 9999n })],
      [toMirrorTxId(debitTx), mirrorTransaction(debitTx, "SUCCESS", { debit: 9999n })],
      [toMirrorTxId(memoedTx), mirrorTransaction(memoedTx, "SUCCESS", { memo: offerMemo(otherOffer) })],
    ]);

    const urls: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/v1/transactions?account.id=")) {
        return Response.json({
          transactions: [
            {
              transaction_id: toMirrorTxId(unloggedTx),
              result: "SUCCESS",
              token_transfers: [{ token_id: USDC_TESTNET, account: AGENT, amount: -10000 }],
            },
            {
              transaction_id: toMirrorTxId(matchedTx),
              result: "SUCCESS",
              token_transfers: [{ token_id: USDC_TESTNET, account: AGENT, amount: -10000 }],
            },
            {
              transaction_id: "0.0.9185802-1793959000-000000001",
              result: "SUCCESS",
              transfers: [{ account: AGENT, amount: -100000000 }],
            },
            {
              transaction_id: "0.0.9185802-1793959001-000000001",
              result: "SUCCESS",
              token_transfers: [{ token_id: USDC_TESTNET, account: AGENT, amount: 10000 }],
            },
          ],
          links: { next: null },
        });
      }
      const id = url.slice(url.lastIndexOf("/") + 1);
      const tx = byId.get(id);
      return tx ? Response.json({ transactions: [tx] }) : new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: "http://mirror.test",
      fetch: fake,
      since: "1793957000.000000001",
    });

    expect(result.matched.map((e) => e.sequence)).toEqual([1]);
    expect(result.unbacked.map((u) => u.logged.sequence)).toEqual([2, 3, 4, 5, 6]);
    expect(result.unbacked.map((u) => u.why)).toEqual([
      "transaction not found",
      "result INVALID_SIGNATURE",
      "payee credit differs",
      "agent debit differs",
      "memo names another offer",
    ]);
    expect(result.unlogged).toEqual([toSdkTxId(unloggedTx)]);
    expect(urls.some((u) => u.includes("timestamp=gte:1793957000.000000001"))).toBe(true);
    expect(urls.some((u) => u.includes("account.id=0.0.11337064"))).toBe(true);
  });

  function reconcileMirror(opts: { executions?: Record<string, object>; schedules?: Record<string, object> } = {}) {
    const urls: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/v1/transactions?account.id=")) {
        return Response.json({ transactions: Object.values(opts.executions ?? {}), links: { next: null } });
      }
      if (url.includes("/api/v1/schedules/")) {
        const id = url.slice(url.lastIndexOf("/") + 1);
        const record = opts.schedules?.[id];
        return record ? Response.json(record) : new Response("{}", { status: 404 });
      }
      const id = url.slice(url.lastIndexOf("/") + 1).split("?")[0]!;
      const tx = opts.executions?.[id];
      return tx ? Response.json({ transactions: [tx] }) : new Response("{}", { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    return { base: "http://mirror.test", fetch, urls };
  }

  function scheduleRecord(over: Record<string, unknown> = {}) {
    return {
      schedule_id: "0.0.500",
      creator_account_id: AGENT,
      payer_account_id: AGENT,
      memo: offerMemo(OFFER),
      executed_timestamp: null,
      expiration_time: "9999999999.000000000",
      deleted: false,
      wait_for_expiry: false,
      transaction_body: "",
      signatures: [],
      ...over,
    };
  }

  test("reconcile matches an executed schedule entry and backs both ids", async () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const executedTx = "0.0.11337064@1793958000.000000001";
    const mirror = reconcileMirror({
      executions: { [toMirrorTxId(createTx)]: mirrorTransaction(executedTx, "SUCCESS") },
    });
    const entries = [logged(1, entry({ kind: "schedule", tx: createTx, schedule: "0.0.500", expiresAt: 1793957300 }))];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.matched.map((e) => e.sequence)).toEqual([1]);
    expect(result.unbacked).toEqual([]);
    expect(result.unlogged).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.released).toEqual([]);
    expect(mirror.urls.some((u) => u.includes("?scheduled=true"))).toBe(true);
  });

  test("reconcile files a pending schedule entry as pending", async () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const mirror = reconcileMirror({ schedules: { "0.0.500": scheduleRecord() } });
    const entries = [logged(1, entry({ kind: "schedule", tx: createTx, schedule: "0.0.500", expiresAt: 1793957300 }))];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.pending.map((e) => e.sequence)).toEqual([1]);
    expect(result.matched).toEqual([]);
    expect(result.unbacked).toEqual([]);
    expect(result.released).toEqual([]);
  });

  test("reconcile files an expired schedule entry as released", async () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const mirror = reconcileMirror({
      schedules: { "0.0.500": scheduleRecord({ expiration_time: "1.000000000" }) },
    });
    const entries = [
      logged(1, entry({ kind: "schedule", tx: createTx, schedule: "0.0.500", expiresAt: 1793957060 })),
      logged(2, entry({ kind: "expired", tx: createTx, schedule: "0.0.500" })),
    ];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.released.map((e) => e.sequence)).toEqual([1]);
    expect(result.unbacked).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  test("reconcile flags an expired entry whose schedule executed", async () => {
    const createTx = "0.0.11337064@1793957000.000000001";
    const executedTx = "0.0.11337064@1793958000.000000001";
    const mirror = reconcileMirror({
      executions: { [toMirrorTxId(createTx)]: mirrorTransaction(executedTx, "SUCCESS") },
      schedules: { "0.0.500": scheduleRecord({ executed_timestamp: "1793958001.000000001" }) },
    });
    const entries = [logged(1, entry({ kind: "expired", tx: createTx, schedule: "0.0.500" }))];

    const result = await reconcile(entries, AGENT, USDC_TESTNET, {
      base: mirror.base,
      fetch: mirror.fetch,
      since: "1793957000.000000001",
    });

    expect(result.unbacked.map((u) => u.why)).toEqual(["logged as expired, but the schedule executed"]);
    expect(result.unlogged).toEqual([]);
  });

  test("an outgoing HBAR-only transfer is never unlogged", async () => {
    const tx = "0.0.9185802@1793957000.000000001";
    const entries = [{ sequence: 1, consensusAt: "1793957000.000000001", entry: entry({ tx }) }];
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/transactions?account.id=")) {
        return Response.json({
          transactions: [
            {
              transaction_id: "0.0.9185802-1793959000-000000001",
              result: "SUCCESS",
              transfers: [{ account: AGENT, amount: -100000000 }],
            },
          ],
          links: { next: null },
        });
      }
      return Response.json({ transactions: [mirrorTransaction(tx, "SUCCESS")] });
    }) as unknown as typeof fetch;

    const result = await reconcile(entries, AGENT, USDC_TESTNET, { base: "http://mirror.test", fetch: fake });
    expect(result.unlogged).toEqual([]);
    expect(result.matched.map((e) => e.sequence)).toEqual([1]);
  });
});
