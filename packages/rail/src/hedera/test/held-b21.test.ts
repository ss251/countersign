import { describe, expect, test } from "bun:test";
import {
  AccountId,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { offerHash, type PaymentPayload, type PaymentRequirements } from "@countersign/core";
import type { Hex } from "viem";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, heldJobId, type HeldRail, type HeldRailOptions } from "../held.ts";
import { offerMemo } from "../memo.ts";
import { NODE, PAYEE, PAYER, hubGatedPayeeKey, hubKey, offer, payerKey } from "./fixtures.ts";

const NOW = 1_000_000;
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@${NOW}.000000000`;
const AMOUNT = 10000n;
const SLIP_HASH = `0x${"11".repeat(32)}` as Hex;
const SELLER_SIG = `0x${"22".repeat(32)}` as Hex;

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

async function countersignBytes(opts: { key?: PrivateKey } = {}): Promise<string> {
  const tx = new ScheduleSignTransaction()
    .setScheduleId(SCHEDULE_ID)
    .setTransactionId(TransactionId.generate(AccountId.fromString(PAYEE)))
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(opts.key ?? payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

interface MirrorState {
  schedules: Record<string, Record<string, unknown> | null>;
  accounts: Record<string, Record<string, unknown> | null>;
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
      if (new URL(url).searchParams.get("scheduled") === "true") {
        return Response.json({ transactions: state.transaction ? [state.transaction] : [] });
      }
      return Response.json({
        transactions: [
          {
            transaction_id: path.slice("/api/v1/transactions/".length),
            name: "SCHEDULECREATE",
            entity_id: SCHEDULE_ID,
            result: "SUCCESS",
            scheduled: false,
          },
        ],
      });
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

function payeeAccount(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { account: PAYEE, receiver_sig_required: true, key: hubGatedPayeeKey(), ...over };
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

function happyState(over: Partial<MirrorState> = {}): MirrorState {
  return {
    schedules: { [SCHEDULE_ID]: scheduleRecord() },
    accounts: { [PAYER]: payerAccount(), [PAYEE]: payeeAccount() },
    transaction: executionRecord(),
    ...over,
  };
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

describe("B21: release confirms the schedule it held", () => {
  test("refuses an execution record whose schedule never executed, then releases once it did", async () => {
    const { rail, mirror } = await railFor(happyState());
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: false,
      errorReason: "execution_failed: schedule not executed",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ executed_timestamp: `${NOW + 5}.000000000` });
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: true,
      payer: PAYER,
      transaction: CREATE_TX,
      network: HEDERA_TESTNET,
    });
  });

  test("refuses a schedule executed at another timestamp", async () => {
    const { rail } = await railFor(
      happyState({
        schedules: { [SCHEDULE_ID]: scheduleRecord({ executed_timestamp: `${NOW - 10}.000000000` }) },
      }),
    );
    await held(rail);
    expect(
      await rail.escrow.release(heldJobId(CREATE_TX), SLIP_HASH, SELLER_SIG, await countersignBytes()),
    ).toEqual({
      success: false,
      errorReason: "execution_failed: schedule executed elsewhere",
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });

  test("releases when the schedule executed at the record's consensus timestamp", async () => {
    const { rail } = await railFor(
      happyState({
        schedules: { [SCHEDULE_ID]: scheduleRecord({ executed_timestamp: `${NOW + 5}.000000000` }) },
      }),
    );
    await held(rail);
    expect(
      await rail.escrow.release(heldJobId(CREATE_TX), SLIP_HASH, SELLER_SIG, await countersignBytes()),
    ).toEqual({
      success: true,
      payer: PAYER,
      transaction: CREATE_TX,
      network: HEDERA_TESTNET,
    });
  });
});

describe("B21: refund and cancel wait until the schedule cannot be signed", () => {
  test("a pending schedule is still signable, and drops only after expiry", async () => {
    for (const mode of ["refund", "cancel"] as const) {
      const { rail, mirror } = await railFor(happyState());
      await held(rail);
      const jobId = heldJobId(CREATE_TX);
      const drop = async () =>
        mode === "refund" ? rail.escrow.refund(jobId) : rail.escrow.cancel(jobId, SELLER_SIG);
      expect(await drop()).toEqual({
        success: false,
        errorReason: "still_signable",
        transaction: "",
        network: HEDERA_TESTNET,
      });
      expect(await rail.escrow.status(jobId)).toBe("funded");
      mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ expiration_time: `${NOW - 1}.000000000` });
      expect(await drop()).toEqual({
        success: true,
        payer: PAYER,
        transaction: CREATE_TX,
        network: HEDERA_TESTNET,
      });
    }
  });

  test("an expired or deleted schedule drops", async () => {
    for (const mode of ["refund", "cancel"] as const) {
      for (const over of [{ expiration_time: `${NOW - 1}.000000000` }, { deleted: true }]) {
        const { rail } = await railFor(happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord(over) } }));
        await held(rail);
        const jobId = heldJobId(CREATE_TX);
        const result =
          mode === "refund" ? await rail.escrow.refund(jobId) : await rail.escrow.cancel(jobId, SELLER_SIG);
        expect(result).toEqual({
          success: true,
          payer: PAYER,
          transaction: CREATE_TX,
          network: HEDERA_TESTNET,
        });
      }
    }
  });

  test("an executed schedule refuses", async () => {
    for (const mode of ["refund", "cancel"] as const) {
      const { rail } = await railFor(
        happyState({
          schedules: { [SCHEDULE_ID]: scheduleRecord({ executed_timestamp: `${NOW + 1}.000000000` }) },
        }),
      );
      await held(rail);
      const jobId = heldJobId(CREATE_TX);
      const result =
        mode === "refund" ? await rail.escrow.refund(jobId) : await rail.escrow.cancel(jobId, SELLER_SIG);
      expect(result).toEqual({
        success: false,
        errorReason: "executed",
        transaction: "",
        network: HEDERA_TESTNET,
      });
    }
  });

  test("a schedule missing from the mirror is unknown, and keeps the hold", async () => {
    for (const mode of ["refund", "cancel"] as const) {
      const { rail, mirror } = await railFor(happyState({ schedules: {} }));
      await held(rail);
      const jobId = heldJobId(CREATE_TX);
      const result =
        mode === "refund" ? await rail.escrow.refund(jobId) : await rail.escrow.cancel(jobId, SELLER_SIG);
      expect(result).toEqual({
        success: false,
        errorReason: "unknown_schedule",
        transaction: "",
        network: HEDERA_TESTNET,
      });
      mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ expiration_time: `${NOW - 1}.000000000` });
      const after = mode === "refund" ? await rail.escrow.refund(jobId) : await rail.escrow.cancel(jobId, SELLER_SIG);
      expect(after.success).toBe(true);
    }
  });
});

describe("B21: verify refuses a schedule with an admin key", () => {
  test("refuses an admin key in any form", async () => {
    const { rail } = await railFor(
      happyState({
        schedules: {
          [SCHEDULE_ID]: scheduleRecord({ admin_key: { _type: "ED25519", key: "ab" } }),
        },
      }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "admin_key",
    });
  });

  test("accepts a schedule with no admin key", async () => {
    const { rail } = await railFor(
      happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ admin_key: null }) } }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({ isValid: true, payer: PAYER });
  });
});
