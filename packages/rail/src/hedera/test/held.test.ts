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
import { keccak256, toBytes, type Hex } from "viem";
import { HEDERA_TESTNET, USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, heldJobId, type HeldRail, type HeldRailOptions } from "../held.ts";
import { offerMemo } from "../memo.ts";
import { NODE, PAYEE, PAYER, offer, payerKey, transfer } from "./fixtures.ts";

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

function scheduledBody(b: { from?: string; to?: string; amount?: bigint; memo?: string } = {}): string {
  const amount = b.amount ?? AMOUNT;
  const memo = b.memo ?? offerMemo(HELD_HASH);
  const inner = new TransferTransaction()
    .addTokenTransfer(TokenId.fromString(USDC_TESTNET), AccountId.fromString(b.from ?? PAYER), -amount)
    .addTokenTransfer(TokenId.fromString(USDC_TESTNET), AccountId.fromString(b.to ?? PAYEE), amount)
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

async function countersignBytes(
  opts: { scheduleId?: string; payee?: string; key?: PrivateKey } = {},
): Promise<string> {
  const tx = new ScheduleSignTransaction()
    .setScheduleId(opts.scheduleId ?? SCHEDULE_ID)
    .setTransactionId(TransactionId.generate(AccountId.fromString(opts.payee ?? PAYEE)))
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(opts.key ?? payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

interface MirrorState {
  schedules: Record<string, Record<string, unknown> | null>;
  accounts: Record<string, Record<string, unknown> | null>;
  /** The SCHEDULECREATE record for the held schedule. */
  create: Record<string, unknown> | null;
  /** The executed child record of the create. */
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
    create: createRecord(),
    transaction: executionRecord(),
    ...over,
  };
}

/** Like happyState, but the schedule itself shows the execution the record reports. */
function executedState(over: Partial<MirrorState> = {}): MirrorState {
  const state = happyState(over);
  state.schedules[SCHEDULE_ID] = scheduleRecord({ executed_timestamp: `${NOW + 5}.000000000` });
  return state;
}

async function railFor(
  state: MirrorState,
  over: Partial<HeldRailOptions> = {},
): Promise<{ rail: HeldRail; mirror: ReturnType<typeof mirrorBox> }> {
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

describe("challenge", () => {
  test("names the scheduled payee, the price and the hold window", async () => {
    const { rail } = await railFor(happyState());
    expect(requirements(rail)).toEqual({
      scheme: "countersign",
      network: HEDERA_TESTNET,
      amount: HELD_OFFER.price,
      asset: USDC_TESTNET,
      payTo: PAYEE,
      maxTimeoutSeconds: HELD_OFFER.deadline,
      extra: {
        name: "hedera-scheduled",
        offerHash: HELD_HASH,
        holdSeconds: HELD_OFFER.deadline + 180,
      },
    });
  });

  test("throws without payTo[\"hedera-scheduled\"]", async () => {
    const { rail } = await railFor(happyState());
    expect(() =>
      rail.challenge(offer({ rails: ["hedera-scheduled"], payTo: {} }), {
        resource: "http://hub.test/offers/x/call",
        now: NOW,
      }),
    ).toThrow("offer has no hedera-scheduled payTo");
  });
});

describe("verify", () => {
  test("accepts a pending schedule inside its hold window", async () => {
    const { rail } = await railFor(happyState());
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({ isValid: true, payer: PAYER });
  });

  test("refuses a payload that is not the D4 shape", async () => {
    const { rail } = await railFor(happyState());
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry, { scheduleId: "0.500" }), entry)).toEqual({
      isValid: false,
      invalidReason: "malformed",
    });
    expect(await rail.verify(heldPayment(entry, { createTxId: "nope" }), entry)).toEqual({
      isValid: false,
      invalidReason: "malformed",
    });
  });

  test("refuses a schedule that was already claimed", async () => {
    const { rail } = await railFor(happyState());
    const entry = await held(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "replay",
    });
  });

  test("refuses a schedule the mirror never shows", async () => {
    const { rail } = await railFor(happyState({ schedules: {} }));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "schedule_not_found",
    });
  });

  test("refuses a deleted schedule", async () => {
    const { rail } = await railFor(happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ deleted: true }) } }));
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "schedule_deleted",
    });
  });

  test("refuses an already executed schedule", async () => {
    const { rail } = await railFor(
      happyState({
        schedules: { [SCHEDULE_ID]: scheduleRecord({ executed_timestamp: `${NOW + 1}.000000000` }) },
      }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "schedule_executed",
    });
  });

  test("refuses an expired schedule", async () => {
    const { rail } = await railFor(
      happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ expiration_time: `${NOW - 1}.000000000` }) } }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "schedule_expired",
    });
  });

  test("refuses a schedule that waits for expiry", async () => {
    const { rail } = await railFor(
      happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ wait_for_expiry: true }) } }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "wait_for_expiry",
    });
  });

  test("refuses a hold window that is too short or too long", async () => {
    const short = await railFor(
      happyState({
        schedules: {
          [SCHEDULE_ID]: scheduleRecord({ expiration_time: `${NOW + HELD_OFFER.deadline + 59}.000000000` }),
        },
      }),
    );
    const shortEntry = requirements(short.rail);
    expect(await short.rail.verify(heldPayment(shortEntry), shortEntry)).toEqual({
      isValid: false,
      invalidReason: "hold_window",
    });

    const long = await railFor(
      happyState({
        schedules: { [SCHEDULE_ID]: scheduleRecord({ expiration_time: `${NOW + 3601}.000000000` }) },
      }),
    );
    const longEntry = requirements(long.rail);
    expect(await long.rail.verify(heldPayment(longEntry), longEntry)).toEqual({
      isValid: false,
      invalidReason: "hold_window",
    });
  });

  test("refuses a scheduled body that moves the wrong amount", async () => {
    const { rail } = await railFor(
      happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ transaction_body: scheduledBody({ amount: 10001n }) }) } }),
    );
    const entry = requirements(rail);
    const result = await rail.verify(heldPayment(entry), entry);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason?.startsWith("mismatch:")).toBe(true);
  });

  test("refuses a payee that does not require its signature", async () => {
    const { rail } = await railFor(
      happyState({ accounts: { [PAYER]: payerAccount(), [PAYEE]: payeeAccount({ receiver_sig_required: false }) } }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "payee_does_not_hold",
    });
  });

  test("refuses a payer key that is not a single supported key", async () => {
    const { rail } = await railFor(
      happyState({
        accounts: {
          [PAYER]: payerAccount({ key: { _type: "CONTRACT", key: payerKey.publicKey.toStringRaw() } }),
          [PAYEE]: payeeAccount(),
        },
      }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "unsupported_payer_key",
    });
  });

  test("refuses a schedule the buyer has not signed", async () => {
    const { rail } = await railFor(
      happyState({ schedules: { [SCHEDULE_ID]: scheduleRecord({ signatures: [] }) } }),
    );
    const entry = requirements(rail);
    expect(await rail.verify(heldPayment(entry), entry)).toEqual({
      isValid: false,
      invalidReason: "payer_not_signed",
    });
  });
});

describe("settle", () => {
  test("holds the schedule without submitting anything", async () => {
    let submits = 0;
    const { rail } = await railFor(happyState(), {
      submit: async () => {
        submits += 1;
        return { status: "SUCCESS" };
      },
    });
    const entry = requirements(rail);
    expect(await rail.settle(heldPayment(entry), entry)).toEqual({
      success: true,
      payer: PAYER,
      transaction: CREATE_TX,
      network: HEDERA_TESTNET,
    });
    expect(submits).toBe(0);
  });

  test("a second settle of the same schedule is a replay", async () => {
    const { rail } = await railFor(happyState());
    const entry = await held(rail);
    expect(await rail.settle(heldPayment(entry), entry)).toEqual({
      success: false,
      errorReason: "replay",
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });
});

describe("release", () => {
  test("submits the countersignature and waits for the exact execution", async () => {
    const submitted: ScheduleSignTransaction[] = [];
    const { rail } = await railFor(executedState(), {
      submit: async (tx) => {
        submitted.push(tx);
        return { status: "SUCCESS" };
      },
    });
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: true,
      payer: PAYER,
      transaction: CREATE_TX,
      network: HEDERA_TESTNET,
    });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.scheduleId?.toString()).toBe(SCHEDULE_ID);
  });

  test("SCHEDULE_ALREADY_EXECUTED counts as submitted", async () => {
    const { rail } = await railFor(executedState(), {
      submit: async () => ({ status: "SCHEDULE_ALREADY_EXECUTED" }),
    });
    await held(rail);
    const result = await rail.escrow.release(heldJobId(CREATE_TX), SLIP_HASH, SELLER_SIG, await countersignBytes());
    expect(result.success).toBe(true);
  });

  test("refuses bytes for another schedule, another payer, or another transaction", async () => {
    const bad = [
      await countersignBytes({ scheduleId: "0.0.501" }),
      await countersignBytes({ payee: "0.0.999" }),
      (await transfer()).base64,
    ];
    for (const countersign of bad) {
      const { rail } = await railFor(executedState());
      await held(rail);
      const jobId = heldJobId(CREATE_TX);
      const first = await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, countersign);
      expect(first.success).toBe(false);
      expect(first.errorReason).toBe("bad_countersign");
      const second = await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes());
      expect(second.success).toBe(true);
    }
  });

  test("refuses no countersignature and keeps the hold", async () => {
    const { rail } = await railFor(executedState());
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG)).toEqual({
      success: false,
      errorReason: "no_countersign",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    const second = await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes());
    expect(second.success).toBe(true);
  });

  test("refuses an unknown job", async () => {
    const { rail } = await railFor(happyState());
    expect(await rail.escrow.release(heldJobId("0.0.999@1.1"), SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: false,
      errorReason: "unknown_job",
      transaction: "",
      network: HEDERA_TESTNET,
    });
  });

  test("reports a refused submit and keeps the hold", async () => {
    const statuses = ["INVALID_SIGNATURE", "SUCCESS"];
    const { rail } = await railFor(executedState(), {
      submit: async () => ({ status: statuses.shift() ?? "SUCCESS" }),
    });
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: false,
      errorReason: "submit_failed: INVALID_SIGNATURE",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    const second = await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes());
    expect(second.success).toBe(true);
  });

  test("reports a failed execution and keeps the hold", async () => {
    const state = executedState({ transaction: executionRecord({ result: "INSUFFICIENT_TOKEN_BALANCE" }) });
    const { rail, mirror } = await railFor(state);
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes())).toEqual({
      success: false,
      errorReason: "execution_failed: INSUFFICIENT_TOKEN_BALANCE",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    mirror.state.transaction = executionRecord();
    const second = await rail.escrow.release(jobId, SLIP_HASH, SELLER_SIG, await countersignBytes());
    expect(second.success).toBe(true);
  });
});

describe("refund and cancel", () => {
  test("refuse a pending schedule and drop it once expired", async () => {
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
      expect(await rail.escrow.status(jobId)).toBe("none");
    }
  });

  test("refuse an executed schedule and keep the hold", async () => {
    const { rail } = await railFor(
      happyState({
        schedules: { [SCHEDULE_ID]: scheduleRecord({ executed_timestamp: `${NOW + 1}.000000000` }) },
      }),
    );
    await held(rail);
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.refund(jobId)).toEqual({
      success: false,
      errorReason: "executed",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    expect(await rail.escrow.cancel(jobId, SELLER_SIG)).toEqual({
      success: false,
      errorReason: "executed",
      transaction: "",
      network: HEDERA_TESTNET,
    });
    expect(await rail.escrow.status(jobId)).toBe("released");
  });
});

describe("status", () => {
  test("reports each state the hold can be in", async () => {
    const { rail, mirror } = await railFor(happyState());
    const jobId = heldJobId(CREATE_TX);
    expect(await rail.escrow.status(jobId)).toBe("none");

    await held(rail);
    expect(await rail.escrow.status(jobId)).toBe("funded");

    mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ executed_timestamp: `${NOW + 1}.000000000` });
    expect(await rail.escrow.status(jobId)).toBe("released");

    mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ deleted: true });
    expect(await rail.escrow.status(jobId)).toBe("refunded");

    mirror.state.schedules[SCHEDULE_ID] = scheduleRecord({ expiration_time: `${NOW - 1}.000000000` });
    expect(await rail.escrow.status(jobId)).toBe("refunded");
  });
});

describe("heldJobId", () => {
  test("is the hub's jobId for a payload with no authorization.nonce", () => {
    expect(heldJobId(CREATE_TX)).toBe(keccak256(toBytes(CREATE_TX)));
  });
});
