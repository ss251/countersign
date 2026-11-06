import { describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import {
  AccountId,
  Hbar,
  ScheduleCreateTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
  type Client,
} from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import { InspectError } from "../inspect.ts";
import { offerMemo } from "../memo.ts";
import {
  checkScheduledTransfer,
  countersignSchedule,
  inspectScheduled,
  scheduleStatus,
  type ExpectedScheduledTransfer,
} from "../schedule.ts";
import { NODE, OFFER_HASH, PAYEE, PAYER, transfer } from "./fixtures.ts";

interface WireField {
  no: number;
  wire: number;
  bytes?: Uint8Array;
}

function readFields(bytes: Uint8Array): WireField[] {
  const fields: WireField[] = [];
  let i = 0;
  const varint = (): bigint => {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const byte = bytes[i++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
  };
  while (i < bytes.length) {
    const key = varint();
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      varint();
    } else if (wire === 2) {
      const length = Number(varint());
      fields.push({ no, wire, bytes: bytes.subarray(i, i + length) });
      i += length;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      throw new Error(`wire ${wire}`);
    }
  }
  return fields;
}

/** The SchedulableTransactionBody inside a ScheduleCreate, in the form the mirror node returns. */
function schedulableBody(createBytes: Uint8Array): Uint8Array {
  const list = readFields(createBytes).find((f) => f.no === 1)!.bytes!;
  const transaction = readFields(list).find((f) => f.no === 5)!.bytes!;
  const signed = readFields(transaction).find((f) => f.no === 1)!.bytes!;
  const scheduleCreate = readFields(signed).find((f) => f.no === 42)!.bytes!;
  return readFields(scheduleCreate).find((f) => f.no === 1)!.bytes!;
}

interface Build {
  from?: string;
  to?: string;
  amount?: bigint;
  asset?: string;
  memo?: string;
  extraTokens?: { account: string; amount: bigint; token?: string }[];
  hbar?: { account: string; tinybars: bigint }[];
}

async function scheduledBody(b: Build = {}): Promise<string> {
  const asset = TokenId.fromString(b.asset ?? USDC_TESTNET);
  const amount = b.amount ?? 10000n;
  const memo = b.memo ?? offerMemo(OFFER_HASH);
  const inner = new TransferTransaction()
    .addTokenTransfer(asset, AccountId.fromString(b.from ?? PAYER), -amount)
    .addTokenTransfer(asset, AccountId.fromString(b.to ?? PAYEE), amount)
    .setTransactionMemo(memo);
  for (const e of b.extraTokens ?? []) {
    inner.addTokenTransfer(TokenId.fromString(e.token ?? USDC_TESTNET), AccountId.fromString(e.account), e.amount);
  }
  for (const h of b.hbar ?? []) {
    inner.addHbarTransfer(AccountId.fromString(h.account), Hbar.fromTinybars(h.tinybars.toString()));
  }
  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(inner)
    .setScheduleMemo(memo)
    .setExpirationTime(Timestamp.fromDate(new Date(Date.now() + 300_000)))
    .setWaitForExpiry(false)
    .setTransactionId(TransactionId.generate(AccountId.fromString(PAYER)))
    .setNodeAccountIds([NODE])
    .freeze();
  return Buffer.from(schedulableBody(create.toBytes())).toString("base64");
}

const want: ExpectedScheduledTransfer = {
  asset: USDC_TESTNET,
  amount: 10000n,
  payTo: PAYEE,
  offerHash: OFFER_HASH,
  payer: PAYER,
};

async function reason(b: Build = {}, w: Partial<ExpectedScheduledTransfer> = {}) {
  const inspected = inspectScheduled(await scheduledBody(b));
  const result = checkScheduledTransfer(inspected, { ...want, ...w });
  return result.ok ? "ok" : result.reason;
}

function bodyBytes(body: string): Uint8Array {
  return new Uint8Array(Buffer.from(body, "base64"));
}

function field(no: number, payload: Uint8Array): Uint8Array {
  if (payload.length >= 128) throw new Error("test helper only writes short fields");
  return Uint8Array.from([(no << 3) | 2, payload.length, ...payload]);
}

function sub(bytes: Uint8Array, no: number): Uint8Array {
  return readFields(bytes).find((f) => f.no === no)!.bytes!;
}

async function crafted(mutate: (body: proto.SchedulableTransactionBody) => void): Promise<string> {
  const body = proto.SchedulableTransactionBody.decode(bodyBytes(await scheduledBody()));
  mutate(body);
  return Buffer.from(proto.SchedulableTransactionBody.encode(body).finish()).toString("base64");
}

function reasonOf(body: string): string {
  const result = checkScheduledTransfer(inspectScheduled(body), want);
  return result.ok ? "ok" : result.reason;
}

describe("inspectScheduled", () => {
  test("reads the transfer, its memo and its accounts from the scheduled body", async () => {
    const inspected = inspectScheduled(await scheduledBody());
    expect(inspected.memo).toBe(offerMemo(OFFER_HASH));
    expect(inspected.tokens[USDC_TESTNET]).toEqual([
      { account: PAYER, amount: -10000n },
      { account: PAYEE, amount: 10000n },
    ]);
    expect(inspected.hbar).toEqual([]);
    expect(inspected.nftCount).toBe(0);
    // A scheduled body carries no create-time fields, so these are deliberately empty.
    expect(inspected.transactionId).toBe("");
    expect(inspected.signerCount).toBe(0);
  });

  test("refuses bytes that do not hold a scheduled transfer", async () => {
    expect(() => inspectScheduled(Buffer.from("garbage").toString("base64"))).toThrow(InspectError);
    const notATransfer = await transfer();
    expect(() => inspectScheduled(notATransfer.base64)).toThrow(InspectError);
  });

  test("refuses an unknown field appended inside cryptoTransfer", async () => {
    const body = bodyBytes(await scheduledBody());
    const transferBody = sub(body, 9);
    const prefix = body.subarray(0, body.length - transferBody.length - 2);
    const unknown = Uint8Array.from([0x3a, 0x02, 0x08, 0x01]);
    const withUnknown = Uint8Array.from([...prefix, ...field(9, Uint8Array.from([...transferBody, ...unknown]))]);
    expect(() => inspectScheduled(Buffer.from(withUnknown).toString("base64"))).toThrow(InspectError);
  });

  test("refuses an allowance transfer", async () => {
    const body = await crafted((decoded) => {
      for (const list of decoded.cryptoTransfer!.tokenTransfers ?? []) {
        for (const amount of list.transfers ?? []) amount.isApproval = true;
      }
    });
    expect(() => inspectScheduled(body)).toThrow("allowance transfers are refused");
  });

  test("refuses a second tokenTransfers entry", async () => {
    const body = await crafted((decoded) => {
      const lists = decoded.cryptoTransfer!.tokenTransfers ?? [];
      lists.push(lists[0]!);
      decoded.cryptoTransfer!.tokenTransfers = lists;
    });
    expect(reasonOf(body)).toBe("extra_transfers");
  });

  test("refuses a non-empty HBAR transfers list", async () => {
    expect(await reason({ hbar: [{ account: PAYER, tinybars: -1n }, { account: PAYEE, tinybars: 1n }] })).toBe(
      "extra_transfers",
    );
  });

  test("refuses another top-level field", async () => {
    const body = await crafted((decoded) => {
      decoded.contractCall = proto.ContractCallTransactionBody.create({});
    });
    expect(() => inspectScheduled(body)).toThrow(InspectError);
  });
});

describe("checkScheduledTransfer", () => {
  test("accepts exactly the buyer's transfer to the seller", async () => {
    const inspected = inspectScheduled(await scheduledBody());
    expect(checkScheduledTransfer(inspected, want)).toEqual({ ok: true, payer: PAYER });
  });

  test("refuses a moved amount in either direction", async () => {
    expect(await reason({ amount: 10001n })).toBe("amount_mismatch");
    expect(await reason({ amount: 9999n })).toBe("amount_mismatch");
    expect(await reason({}, { amount: 20000n })).toBe("amount_mismatch");
  });

  test("refuses another offer's memo", async () => {
    expect(await reason({ memo: offerMemo("0x" + "11".repeat(32)) })).toBe("offer_mismatch");
    expect(await reason({ memo: "" })).toBe("offer_mismatch");
    expect(await reason({ memo: "thanks" })).toBe("offer_mismatch");
  });

  test("refuses the wrong token or payee", async () => {
    expect(await reason({ asset: "0.0.1234" })).toBe("wrong_asset");
    expect(await reason({}, { asset: "0.0.0" })).toBe("wrong_asset");
    expect(await reason({ to: "0.0.999" })).toBe("wrong_payee");
  });

  test("refuses anything moved besides the price", async () => {
    expect(await reason({ hbar: [{ account: PAYER, tinybars: -1n }, { account: PAYEE, tinybars: 1n }] })).toBe(
      "extra_transfers",
    );
    expect(
      await reason({ extraTokens: [{ account: PAYEE, amount: 1n }, { account: "0.0.777", amount: -1n }] }),
    ).not.toBe("ok");
    expect(
      await reason({
        extraTokens: [{ account: PAYER, amount: -5n, token: "0.0.555" }, { account: PAYEE, amount: 5n, token: "0.0.555" }],
      }),
    ).toBe("wrong_asset");
  });

  test("refuses a debit that is not the buyer's account", async () => {
    expect(await reason({}, { payer: "0.0.999" })).toBe("wrong_payer");
    expect(await reason({ from: "0.0.999" })).toBe("wrong_payer");
  });
});

function mirrorRecords(records: Record<string, object>) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const id = url.slice(url.lastIndexOf("/") + 1);
    const record = records[id];
    return record ? Response.json(record) : new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, urls };
}

function record(over: Record<string, unknown> = {}) {
  return {
    schedule_id: "0.0.500",
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: offerMemo(OFFER_HASH),
    executed_timestamp: null,
    expiration_time: "9999999999.000000000",
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

describe("countersignSchedule", () => {
  test("refuses when the mirror never shows the schedule and never signs", async () => {
    const mirror = mirrorRecords({});
    await expect(
      countersignSchedule({} as Client, "0.0.599", want, {
        ...mirror,
        pollIntervalMs: 1,
        pollTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: "ScheduleRefusedError", reason: "not_found" });
  });
});

describe("scheduleStatus", () => {
  const records = {
    "0.0.501": record({ schedule_id: "0.0.501", expiration_time: "1970-01-01T00:03:20.000000000Z" }),
    "0.0.502": record({ schedule_id: "0.0.502", executed_timestamp: "1793958001.000000001" }),
    "0.0.503": record({ schedule_id: "0.0.503", expiration_time: "1.000000000" }),
    "0.0.504": record({ schedule_id: "0.0.504", deleted: true }),
  };
  const mirror = mirrorRecords(records);
  const now = () => 100;

  test("pending when the expiration is still ahead", async () => {
    expect(await scheduleStatus("0.0.501", { ...mirror, now })).toBe("pending");
  });

  test("executed when the mirror records an execution", async () => {
    expect(await scheduleStatus("0.0.502", { ...mirror, now })).toBe("executed");
  });

  test("expired when the clock is past the expiration and nothing executed", async () => {
    expect(await scheduleStatus("0.0.503", { ...mirror, now })).toBe("expired");
  });

  test("deleted wins over every other field", async () => {
    expect(await scheduleStatus("0.0.504", { ...mirror, now })).toBe("deleted");
  });

  test("reads the mirror schedule path", async () => {
    await scheduleStatus("0.0.501", { ...mirror, now });
    expect(mirror.urls.at(-1)).toBe("http://mirror.test/api/v1/schedules/0.0.501");
  });
});
