import { describe, expect, test } from "bun:test";
import {
  AccountId,
  ScheduleCreateTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { offerHash, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import { USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, type HeldRail, type HeldRailOptions } from "../held.ts";
import { offerMemo } from "../memo.ts";
import { NODE, PAYEE, PAYER, offer, payerKey } from "./fixtures.ts";

const NOW = 1_000_000;
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@${NOW}.000000000`;
const AMOUNT = 10000n;

const HELD_OFFER = offer({
  rails: ["hedera-scheduled"],
  payTo: { "hedera-scheduled": PAYEE },
  deadline: 120,
});
const HELD_HASH = offerHash(HELD_OFFER);

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

function scheduledBody(): string {
  const token = TokenId.fromString(USDC_TESTNET);
  const memo = offerMemo(HELD_HASH);
  const inner = new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(PAYER), -AMOUNT)
    .addTokenTransfer(token, AccountId.fromString(PAYEE), AMOUNT)
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

interface MirrorState {
  schedules: Record<string, Record<string, unknown> | null>;
  accounts: Record<string, Record<string, unknown> | null>;
  create: Record<string, unknown> | null;
}

function mirrorBox(state: MirrorState) {
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path.startsWith("/api/v1/schedules/")) {
      const id = path.slice("/api/v1/schedules/".length);
      const record = state.schedules[id];
      return record ? Response.json(record) : new Response("not found", { status: 404 });
    }
    if (path.startsWith("/api/v1/accounts/")) {
      const id = path.slice("/api/v1/accounts/".length);
      const record = state.accounts[id];
      return record ? Response.json(record) : new Response("not found", { status: 404 });
    }
    if (path.startsWith("/api/v1/transactions/")) {
      return Response.json({ transactions: state.create ? [state.create] : [] });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, state };
}

function payerAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: PAYER,
    key: { _type: "ECDSA_SECP256K1", key: payerKey.publicKey.toStringRaw() },
    ...over,
  };
}

function payeeAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { account: PAYEE, receiver_sig_required: true, ...over };
}

function scheduleRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schedule_id: SCHEDULE_ID,
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: offerMemo(HELD_HASH),
    executed_timestamp: null,
    expiration_time: `${NOW + 600}.000000000`,
    deleted: false,
    wait_for_expiry: false,
    transaction_body: scheduledBody(),
    signatures: [
      { public_key_prefix: Buffer.from(payerKey.publicKey.toBytesRaw().subarray(0, 8)).toString("base64") },
    ],
    ...over,
  };
}

function createRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_id: CREATE_TX,
    result: "SUCCESS",
    name: "SCHEDULECREATE",
    entity_id: SCHEDULE_ID,
    consensus_timestamp: `${NOW}.000000000`,
    ...over,
  };
}

function happyState(over: Partial<MirrorState> = {}): MirrorState {
  return {
    schedules: { [SCHEDULE_ID]: scheduleRecord() },
    accounts: { [PAYER]: payerAccount(), [PAYEE]: payeeAccount() },
    create: createRecord(),
    ...over,
  };
}

async function railFor(state: MirrorState, over: Partial<HeldRailOptions> = {}): Promise<{ rail: HeldRail }> {
  const mirror = mirrorBox(state);
  const rail = await createHederaHeldRail({
    mirror,
    now: () => NOW,
    waitScheduleMs: 0,
    pollMs: 1,
    executionTimeoutMs: 200,
    submit: async () => ({ status: "SUCCESS" }),
    ...over,
  });
  return { rail };
}

function requirements(rail: HeldRail): PaymentRequirements {
  return rail.challenge(HELD_OFFER, { resource: "http://hub.test/offers/x/call", now: NOW });
}

function heldPayment(entry: PaymentRequirements): PaymentPayload {
  return {
    x402Version: 2,
    accepted: entry,
    payload: { scheduleId: SCHEDULE_ID, createTxId: CREATE_TX },
  };
}

describe("verify checks the schedule's own create", () => {
  test("accepts the payload when createTxId is the schedule's successful SCHEDULECREATE", async () => {
    const { rail } = await railFor(happyState());
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({ isValid: true, payer: PAYER });
  });

  test("refuses a create transaction that made another schedule", async () => {
    const { rail } = await railFor(happyState({ create: createRecord({ entity_id: "0.0.501" }) }));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "create_mismatch",
    });
  });

  test("refuses a CRYPTOTRANSFER transaction", async () => {
    const { rail } = await railFor(happyState({ create: createRecord({ name: "CRYPTOTRANSFER" }) }));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "create_mismatch",
    });
  });

  test("a missing create record is a mismatch", async () => {
    const { rail } = await railFor(happyState({ create: null }));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "create_mismatch",
    });
  });
});
