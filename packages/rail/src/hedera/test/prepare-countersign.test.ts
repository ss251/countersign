import { describe, expect, test } from "bun:test";
import {
  AccountId,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenId,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import { offerMemo } from "../memo.ts";
import { prepareCountersign, type ExpectedScheduledTransfer } from "../schedule.ts";
import { NODE, OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

const SELLER = "0.0.11337066";
const SCHEDULE_ID = "0.0.500";
const sellerKey = PrivateKey.generateECDSA();

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

function scheduledBody(amount = 10000n): string {
  const token = TokenId.fromString(USDC_TESTNET);
  const memo = offerMemo(OFFER_HASH);
  const inner = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(PAYER), -amount)
    .addTokenTransfer(token, AccountId.fromString(PAYEE), amount)
    .setTransactionMemo(memo);
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
    schedule_id: SCHEDULE_ID,
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: offerMemo(OFFER_HASH),
    executed_timestamp: null,
    expiration_time: "9999999999.000000000",
    deleted: false,
    wait_for_expiry: false,
    transaction_body: scheduledBody(),
    signatures: [],
    ...over,
  };
}

const POLL = { pollIntervalMs: 1, pollTimeoutMs: 10, nodeAccountIds: ["0.0.3"] };

describe("prepareCountersign", () => {
  test("returns a signed ScheduleSign for the seller, without submitting it", async () => {
    const mirror = mirrorRecords({ [SCHEDULE_ID]: record() });
    const prepared = await prepareCountersign(SELLER, sellerKey, SCHEDULE_ID, want, { ...mirror, ...POLL });

    const tx = Transaction.fromBytes(Buffer.from(prepared.bytes, "base64"));
    expect(tx).toBeInstanceOf(ScheduleSignTransaction);
    const sign = tx as ScheduleSignTransaction;
    expect(sign.scheduleId?.toString()).toBe(SCHEDULE_ID);
    expect(sign.transactionId?.accountId?.toString()).toBe(SELLER);
    expect(prepared.transactionId).toBe(sign.transactionId!.toString());

    const signers = sign
      .getSignatures()
      .getFlatSignatureList()
      .flatMap((pairs) => [...pairs.keys()].map((key) => key.toStringRaw()));
    expect(signers).toContain(sellerKey.publicKey.toStringRaw());
  });

  test("refuses a schedule that is not pending", async () => {
    const mirror = mirrorRecords({
      [SCHEDULE_ID]: record({ executed_timestamp: "1793957001.000000001" }),
    });
    await expect(prepareCountersign(SELLER, sellerKey, SCHEDULE_ID, want, { ...mirror, ...POLL }))
      .rejects.toMatchObject({ name: "ScheduleRefusedError", reason: "executed" });
  });

  test("refuses a schedule that waits for expiry", async () => {
    const mirror = mirrorRecords({ [SCHEDULE_ID]: record({ wait_for_expiry: true }) });
    await expect(prepareCountersign(SELLER, sellerKey, SCHEDULE_ID, want, { ...mirror, ...POLL }))
      .rejects.toMatchObject({ name: "ScheduleRefusedError", reason: "wait_for_expiry" });
  });

  test("refuses a schedule whose fee payer is not the buyer", async () => {
    const mirror = mirrorRecords({ [SCHEDULE_ID]: record({ payer_account_id: "0.0.999" }) });
    await expect(prepareCountersign(SELLER, sellerKey, SCHEDULE_ID, want, { ...mirror, ...POLL }))
      .rejects.toMatchObject({ name: "ScheduleRefusedError", reason: "payer_mismatch" });
  });

  test("refuses a scheduled amount that is not the offer's price", async () => {
    const mirror = mirrorRecords({ [SCHEDULE_ID]: record({ transaction_body: scheduledBody(10001n) }) });
    await expect(prepareCountersign(SELLER, sellerKey, SCHEDULE_ID, want, { ...mirror, ...POLL }))
      .rejects.toMatchObject({
        name: "ScheduleRefusedError",
        reason: "mismatch",
        refusal: "amount_mismatch",
      });
  });
});
