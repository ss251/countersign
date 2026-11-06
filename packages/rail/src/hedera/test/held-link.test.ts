import { describe, expect, test } from "bun:test";
import {
  AccountId,
  ScheduleSignTransaction,
  TransactionId,
} from "@hiero-ledger/sdk";
import type { PaymentPayload, PaymentRequirements } from "@countersign/core";
import type { Hex } from "viem";
import { USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, heldJobId, type HeldRail } from "../held.ts";
import { NODE, PAYEE, PAYER, offer, payerKey } from "./fixtures.ts";

const NOW = 1_000_000;
const SCHEDULE_ID = "0.0.500";
const CREATE_TX = `${PAYER}@${NOW}.000000000`;
const CONSENSUS = `${NOW + 5}.000000000`;
const AMOUNT = 10000n;
const SLIP_HASH = `0x${"11".repeat(32)}` as Hex;
const SELLER_SIG = `0x${"22".repeat(32)}` as Hex;

const HELD_OFFER = offer({
  rails: ["hedera-scheduled"],
  payTo: { "hedera-scheduled": PAYEE },
  deadline: 120,
});
interface MirrorState {
  schedules: Record<string, Record<string, unknown> | null>;
  create: Record<string, unknown> | null;
  transaction: Record<string, unknown> | null;
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
    if (path.startsWith("/api/v1/transactions/")) {
      const scheduled = new URL(url).searchParams.get("scheduled") === "true";
      const record = scheduled ? state.transaction : state.create;
      return Response.json({ transactions: record ? [record] : [] });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch, state };
}

function scheduleRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schedule_id: SCHEDULE_ID,
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: "",
    executed_timestamp: CONSENSUS,
    expiration_time: `${NOW + 600}.000000000`,
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

function createRecord(): Record<string, unknown> {
  return {
    transaction_id: CREATE_TX,
    result: "SUCCESS",
    name: "SCHEDULECREATE",
    entity_id: SCHEDULE_ID,
    consensus_timestamp: `${NOW}.000000000`,
  };
}

function executionRecord(): Record<string, unknown> {
  return {
    transaction_id: CREATE_TX,
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    consensus_timestamp: CONSENSUS,
    token_transfers: [
      { token_id: USDC_TESTNET, account: PAYEE, amount: String(AMOUNT) },
      { token_id: USDC_TESTNET, account: PAYER, amount: String(-AMOUNT) },
    ],
  };
}

function executedState(): MirrorState {
  return {
    schedules: { [SCHEDULE_ID]: scheduleRecord() },
    create: createRecord(),
    transaction: executionRecord(),
  };
}

async function railFor(state: MirrorState): Promise<HeldRail> {
  return createHederaHeldRail({
    mirror: mirrorBox(state),
    now: () => NOW,
    waitScheduleMs: 0,
    pollMs: 1,
    executionTimeoutMs: 200,
    submit: async () => ({ status: "SUCCESS" }),
  });
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

async function countersignBytes(): Promise<string> {
  const tx = new ScheduleSignTransaction()
    .setScheduleId(SCHEDULE_ID)
    .setTransactionId(TransactionId.generate(AccountId.fromString(PAYEE)))
    .setNodeAccountIds([NODE])
    .freeze();
  await tx.sign(payerKey);
  return Buffer.from(tx.toBytes()).toString("base64");
}

describe("a held release links its execution", () => {
  test("returns the execution's consensus time while the transaction stays the create", async () => {
    const rail = await railFor(executedState());
    const entry = requirements(rail);
    const settled = await rail.settle(heldPayment(entry), entry);
    expect(settled.success).toBe(true);

    const released = await rail.escrow.release(
      heldJobId(CREATE_TX),
      SLIP_HASH,
      SELLER_SIG,
      await countersignBytes(),
    );
    expect(released.success).toBe(true);
    expect(released.explorerRef).toBe(CONSENSUS);
    expect(released.transaction).toBe(CREATE_TX);
  });
});
