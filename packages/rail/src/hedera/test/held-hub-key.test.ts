import { describe, expect, test } from "bun:test";
import { proto } from "@hiero-ledger/proto";
import {
  AccountId,
  Key,
  KeyList,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { offerHash, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import { keccak256, toBytes, type Hex } from "viem";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, heldJobId, type HeldRail, type HeldRailOptions } from "../held.ts";
import { offerMemo } from "../memo.ts";
import { NODE, PAYEE, PAYER, offer, payerKey } from "./fixtures.ts";

const NOW = 1_000_000;
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@${NOW}.000000000`;
const AMOUNT = 10000n;
const SLIP_HASH = `0x${"11".repeat(32)}` as Hex;
const SELLER_SIG = `0x${"22".repeat(32)}` as Hex;

const sellerKey = PrivateKey.generateED25519();
const hubKey = PrivateKey.generateED25519();
const otherKey = PrivateKey.generateED25519();

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
  const memo = offerMemo(HELD_HASH);
  const inner = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(USDC_TESTNET), AccountId.fromString(PAYER), -AMOUNT)
    .addTokenTransfer(TokenId.fromString(USDC_TESTNET), AccountId.fromString(PAYEE), AMOUNT)
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

async function countersignBytes(opts: { key?: PrivateKey; scheduleId?: string; payee?: string } = {}): Promise<string> {
  const tx = new ScheduleSignTransaction()
    .setScheduleId(opts.scheduleId ?? SCHEDULE_ID)
    .setTransactionId(TransactionId.generate(AccountId.fromString(opts.payee ?? PAYEE)))
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(opts.key ?? sellerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

interface MirrorState {
  schedules: Record<string, Record<string, unknown> | null>;
  accounts: Record<string, Record<string, unknown> | null>;
  create: Record<string, unknown> | null;
  transaction: Record<string, unknown> | null;
}

function mirrorBox(state: MirrorState) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
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
      const scheduled = new URL(url).searchParams.get("scheduled") === "true";
      const record = scheduled ? state.transaction : state.create;
      return Response.json({ transactions: record ? [record] : [] });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, urls, state };
}

function payerAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: PAYER,
    key: { _type: "ECDSA_SECP256K1", key: payerKey.publicKey.toStringRaw() },
    ...over,
  };
}

function protobufKey(key: Key): { _type: string; key: string } {
  return {
    _type: "ProtobufEncoded",
    key: Buffer.from(proto.Key.encode(key._toProtobufKey()).finish()).toString("hex"),
  };
}

function payeeAccount(key: Key | null, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    account: PAYEE,
    receiver_sig_required: true,
    ...(key ? { key: protobufKey(key) } : {}),
    ...over,
  };
}

function gatedKeyList(): KeyList {
  return new KeyList([sellerKey.publicKey, hubKey.publicKey]);
}

function gatedThreshold(): KeyList {
  return new KeyList([sellerKey.publicKey, hubKey.publicKey], 2);
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

function executionRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transaction_id: CREATE_TX,
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensus_timestamp: `${NOW + 5}.000000000`,
    token_transfers: [
      { token_id: USDC_TESTNET, account: PAYEE, amount: String(AMOUNT) },
      { token_id: USDC_TESTNET, account: PAYER, amount: String(-AMOUNT) },
    ],
    ...over,
  };
}

function happyState(key: Key | null = gatedKeyList(), over: Partial<MirrorState> = {}): MirrorState {
  return {
    schedules: { [SCHEDULE_ID]: scheduleRecord() },
    accounts: { [PAYER]: payerAccount(), [PAYEE]: payeeAccount(key) },
    create: createRecord(),
    transaction: executionRecord(),
    ...over,
  };
}

/** Like happyState, but the schedule itself shows the execution the record reports. */
function executedState(key: Key | null = gatedKeyList(), over: Partial<MirrorState> = {}): MirrorState {
  const state = happyState(key, over);
  state.schedules[SCHEDULE_ID] = scheduleRecord({ executed_timestamp: `${NOW + 5}.000000000` });
  return state;
}

async function railFor(
  state: MirrorState,
  over: Partial<HeldRailOptions> = {},
): Promise<{ rail: HeldRail; mirror: ReturnType<typeof mirrorBox> }> {
  const mirror = mirrorBox(state);
  const rail = await createHederaHeldRail({
    hubKey,
    mirror,
    now: () => NOW,
    waitScheduleMs: 0,
    pollMs: 1,
    executionTimeoutMs: 200,
    submit: async () => ({ status: "SUCCESS" }),
    ...over,
  });
  return { rail, mirror };
}

function requirements(rail: HeldRail): PaymentRequirements {
  return rail.challenge(HELD_OFFER, { resource: "http://hub.test/offers/x/call", now: NOW });
}

function heldPayment(entry: PaymentRequirements, over: Record<string, unknown> = {}): PaymentPayload {
  return {
    x402Version: 2,
    accepted: entry,
    payload: { scheduleId: SCHEDULE_ID, createTxId: CREATE_TX, ...over },
  };
}

async function held(rail: HeldRail): Promise<PaymentRequirements> {
  const entry = requirements(rail);
  const settled = await rail.settle(heldPayment(entry), entry);
  expect(settled.success).toBe(true);
  return entry;
}

function signatureKeys(tx: ScheduleSignTransaction): string[] {
  return tx
    .getSignatures()
    .getFlatSignatureList()
    .flatMap((map) => [...map.keys()].map((key) => key.toStringRaw()));
}

describe("construction", () => {
  test("refuses to start without the hub release key", async () => {
    await expect(
      createHederaHeldRail({ mirror: {} } as unknown as HeldRailOptions),
    ).rejects.toThrow("the held rail needs its hub release key");
  });
});

describe("challenge", () => {
  test("names the hub's raw public key so a buyer can check the payee", async () => {
    const { rail } = await railFor(happyState());
    expect(requirements(rail).extra?.hubKey).toBe(hubKey.publicKey.toStringRaw());
  });
});

describe("verify", () => {
  test("accepts a 2-of-2 key list of the seller and the hub", async () => {
    const { rail } = await railFor(happyState(gatedKeyList()));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({ isValid: true, payer: PAYER });
  });

  test("accepts a threshold-2 key over the seller and the hub", async () => {
    const { rail } = await railFor(happyState(gatedThreshold()));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({ isValid: true, payer: PAYER });
  });

  const refused: Array<[string, Key | null, Record<string, unknown>?]> = [
    ["a single ed25519 key", sellerKey.publicKey],
    ["a two-key list without the hub", new KeyList([sellerKey.publicKey, otherKey.publicKey])],
    ["a threshold-1 key over the two", new KeyList([sellerKey.publicKey, hubKey.publicKey], 1)],
    ["a three-key list", new KeyList([sellerKey.publicKey, hubKey.publicKey, otherKey.publicKey])],
    ["a payee that does not require its signature", gatedKeyList(), { receiver_sig_required: false }],
    ["an account with no key", null],
  ];

  for (const [name, key, over] of refused) {
    test(`refuses ${name}`, async () => {
      const state = happyState(key);
      if (over) state.accounts[PAYEE] = payeeAccount(key, over);
      const { rail } = await railFor(state);
      const entry = requirements(rail);
      expect(await rail.verify(heldPayment(entry), entry)).toEqual({
        isValid: false,
        invalidReason: "payee_not_hub_gated",
      });
    });
  }
});

describe("release", () => {
  test("adds the hub's signature to the seller's ScheduleSign", async () => {
    const submitted: ScheduleSignTransaction[] = [];
    const { rail } = await railFor(executedState(), {
      submit: async (tx) => {
        submitted.push(tx);
        return { status: "SUCCESS" };
      },
    });
    await held(rail);
    const result = await rail.escrow.release(heldJobId(CREATE_TX), SLIP_HASH, SELLER_SIG, await countersignBytes());
    expect(result.success).toBe(true);
    expect(submitted).toHaveLength(1);
    const keys = signatureKeys(submitted[0]!);
    expect(keys).toContain(hubKey.publicKey.toStringRaw());
    expect(keys).toContain(sellerKey.publicKey.toStringRaw());
  });
});
