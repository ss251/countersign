import { describe, expect, test } from "bun:test";
import { offerHash, type Envelope, type Offer } from "@countersign/core";
import { HEDERA_TESTNET, USDC_TESTNET } from "@countersign/rail/hedera";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createHederaAgent, spentFromLog, type ScheduleHold } from "../agent.ts";
import type { LoggedEntry, SpendEntry } from "../spendlog.ts";

const PAYER = "0.0.11337064";
const PAYEE = "0.0.11337065";
const SELLER = "0x00000000000000000000000000000000000000a1";
const TOPIC = "0.0.11337070";
const SCHEDULE = "0.0.500";
const CREATE_TX = "0.0.11337064@1793957000.000000001";
const NOW = 1793957000;

const payer = { accountId: PAYER, key: PrivateKey.generateECDSA() };

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

function envelope(): Envelope {
  return {
    v: 1,
    agent: "0x00000000000000000000000000000000000000b2",
    cap: "1000000",
    perMerchant: "500000",
    allowlist: [],
    revoked: false,
  };
}

const HOLD: ScheduleHold = {
  scheduleId: SCHEDULE,
  createTxId: CREATE_TX,
  offerHash: OFFER,
  seller: SELLER,
  payTo: PAYEE,
  asset: USDC_TESTNET,
  amount: "10000",
};

function record(over: Record<string, unknown> = {}) {
  return {
    schedule_id: SCHEDULE,
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: "",
    executed_timestamp: null,
    expiration_time: `${NOW + 300}.000000000`,
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

function mirrorFor(value: () => object | null) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const r = value();
    return r ? Response.json(r) : new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, urls };
}

function agentFor(entries: SpendEntry[], mirror: { base: string; fetch: typeof globalThis.fetch }) {
  return createHederaAgent({
    hub: "http://127.0.0.1:0",
    payer,
    envelope: envelope(),
    topicId: TOPIC,
    spent: { total: "10000", bySeller: { [SELLER]: "10000" } },
    appendLog: async (entry) => {
      entries.push(entry);
      return { sequence: entries.length };
    },
    mirror,
    now: () => NOW,
  });
}

describe("releaseExpired waits out a lagging mirror", () => {
  test("stays pending while the expiration is inside the release margin", async () => {
    const entries: SpendEntry[] = [];
    const mirror = mirrorFor(() => record({ expiration_time: `${NOW - 30}.000000000` }));
    const agent = agentFor(entries, mirror);

    expect(await agent.releaseExpired(HOLD)).toBe("pending");
    expect(entries).toEqual([]);
    expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
    expect(mirror.urls.at(-1)).toBe("http://mirror.test/api/v1/schedules/0.0.500");
  });

  test("releases once the expiration is more than the margin in the past", async () => {
    const entries: SpendEntry[] = [];
    const mirror = mirrorFor(() => record({ expiration_time: `${NOW - 61}.000000000` }));
    const agent = agentFor(entries, mirror);

    expect(await agent.releaseExpired(HOLD)).toBe("released");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "expired",
      tx: CREATE_TX,
      schedule: SCHEDULE,
      offerHash: OFFER,
      seller: SELLER,
      payTo: PAYEE,
      asset: USDC_TESTNET,
      amount: "10000",
      total: "0",
    });
    expect(agent.spent).toEqual({ total: "0", bySeller: { [SELLER]: "0" } });
  });

  test("releases a deleted schedule before its expiration", async () => {
    const entries: SpendEntry[] = [];
    const mirror = mirrorFor(() => record({ deleted: true }));
    const agent = agentFor(entries, mirror);

    expect(await agent.releaseExpired(HOLD)).toBe("released");
    expect(entries.map((e) => e.kind)).toEqual(["expired"]);
    expect(agent.spent).toEqual({ total: "0", bySeller: { [SELLER]: "0" } });
  });

  test("leaves an executed schedule alone, even past the expiration", async () => {
    const entries: SpendEntry[] = [];
    const mirror = mirrorFor(() =>
      record({ executed_timestamp: "1793957001.000000001", expiration_time: `${NOW - 300}.000000000` }),
    );
    const agent = agentFor(entries, mirror);

    expect(await agent.releaseExpired(HOLD)).toBe("executed");
    expect(entries).toEqual([]);
    expect(agent.spent).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
  });

  test("a missing schedule record is still pending", async () => {
    const entries: SpendEntry[] = [];
    const agent = agentFor(entries, mirrorFor(() => null));

    expect(await agent.releaseExpired(HOLD)).toBe("pending");
    expect(entries).toEqual([]);
  });
});

function logged(sequence: number, entry: SpendEntry): LoggedEntry {
  return { sequence, consensusAt: `17939570${sequence}.000000001`, entry };
}

function spend(over: Partial<SpendEntry> = {}): SpendEntry {
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
    tx: "0.0.11337064@1793958000.000000001",
    schedule: SCHEDULE,
    total: "10000",
    cap: "1000000",
    at: NOW + 1,
    ...over,
  };
}

function scheduleEntry(): SpendEntry {
  return {
    ...spend({ kind: "schedule", tx: CREATE_TX, expiresAt: NOW + 300 }),
  };
}

function expiredEntry(): SpendEntry {
  return {
    ...spend({ kind: "expired", tx: CREATE_TX, total: "0" }),
  };
}

describe("spentFromLog restores a spend that follows a wrong release", () => {
  test("a spend after its release adds the amount back", () => {
    const entries = [logged(1, scheduleEntry()), logged(2, expiredEntry()), logged(3, spend())];

    expect(spentFromLog(entries)).toEqual({ total: "10000", bySeller: { [SELLER]: "10000" } });
  });

  test("a second spend for the released schedule adds nothing", () => {
    const entries = [
      logged(1, scheduleEntry()),
      logged(2, expiredEntry()),
      logged(3, spend()),
      logged(4, spend({ tx: "0.0.11337064@1793958001.000000001" })),
    ];

    expect(spentFromLog(entries).total).toBe("10000");
  });
});
