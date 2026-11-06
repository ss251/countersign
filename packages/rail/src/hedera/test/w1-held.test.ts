import { describe, expect, test } from "bun:test";
import {
  AccountId,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { offerHash, type PaymentPayload } from "@countersign/core";
import type { Hex } from "viem";
import { USDC_TESTNET } from "../constants.ts";
import { createHederaHeldRail, heldJobId } from "../held.ts";
import { offerMemo } from "../memo.ts";
import { NODE, PAYEE, PAYER, hubGatedPayeeKey, hubKey, offer, payerKey } from "./fixtures.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// The payment names a schedule and, separately, a create transaction. Verify checks the schedule;
// nothing checks that the create transaction is that schedule's. Release then confirms the payment by
// the execution record of the named create transaction, not of the schedule it held. A buyer who once
// paid this seller the same amount through another schedule (on another hub, or outside countersign)
// names that old create transaction: the seller delivers and countersigns the new schedule, the new
// schedule never executes (the buyer emptied its account), and release still reports the seller paid.

const NOW = 1_000_000;
const NEW_SCHEDULE = "0.0.500";
const OLD_CREATE_TX = `${PAYER}@${NOW - 86_400}.000000000`;
const AMOUNT = 10000n;

const HELD_OFFER = offer({ rails: ["hedera-scheduled"], payTo: { "hedera-scheduled": PAYEE }, deadline: 120 });
const HELD_HASH = offerHash(HELD_OFFER);

function fields(bytes: Uint8Array): Array<{ no: number; bytes?: Uint8Array }> {
  const out: Array<{ no: number; bytes?: Uint8Array }> = [];
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
    if (wire === 0) varint();
    else if (wire === 2) {
      const length = Number(varint());
      out.push({ no, bytes: bytes.subarray(i, i + length) });
      i += length;
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error(`wire ${wire}`);
  }
  return out;
}

/** The SchedulableTransactionBody of a fresh ScheduleCreate, as the mirror returns it. */
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
  const list = fields(create.toBytes()).find((f) => f.no === 1)!.bytes!;
  const transaction = fields(list).find((f) => f.no === 5)!.bytes!;
  const signed = fields(transaction).find((f) => f.no === 1)!.bytes!;
  const scheduleCreate = fields(signed).find((f) => f.no === 42)!.bytes!;
  return Buffer.from(fields(scheduleCreate).find((f) => f.no === 1)!.bytes!).toString("base64");
}

describe("W1 B21: release confirms a create transaction the payment named, not the schedule it held", () => {
  test("a schedule that never executed is not reported as the seller paid", async () => {
    // The mirror: the new schedule is pending and stays unexecuted. The only execution record it holds
    // for the named create transaction is the old one, an earlier transfer of the same amount.
    const fetch = (async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path === `/api/v1/schedules/${NEW_SCHEDULE}`) {
        return Response.json({
          schedule_id: NEW_SCHEDULE,
          creator_account_id: PAYER,
          payer_account_id: PAYER,
          memo: offerMemo(HELD_HASH),
          executed_timestamp: null,
          expiration_time: `${NOW + 600}.000000000`,
          deleted: false,
          wait_for_expiry: false,
          transaction_body: scheduledBody(),
          signatures: [{ public_key_prefix: Buffer.from(payerKey.publicKey.toBytesRaw().subarray(0, 8)).toString("base64") }],
        });
      }
      if (path === `/api/v1/accounts/${PAYER}`) {
        return Response.json({ account: PAYER, key: { _type: "ECDSA_SECP256K1", key: payerKey.publicKey.toStringRaw() } });
      }
      if (path === `/api/v1/accounts/${PAYEE}`) {
        return Response.json({ account: PAYEE, receiver_sig_required: true, key: hubGatedPayeeKey() });
      }
      if (path.startsWith("/api/v1/transactions/")) {
        return Response.json({
          transactions: [
            {
              transaction_id: OLD_CREATE_TX,
              result: "SUCCESS",
              name: "CRYPTOTRANSFER",
              consensus_timestamp: `${NOW - 86_395}.000000000`,
              token_transfers: [
                { token_id: USDC_TESTNET, account: PAYEE, amount: String(AMOUNT) },
                { token_id: USDC_TESTNET, account: PAYER, amount: String(-AMOUNT) },
              ],
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const rail = await createHederaHeldRail({
      hubKey,
      mirror: { base: "http://mirror.test", fetch },
      now: () => NOW,
      waitScheduleMs: 0,
      pollMs: 1,
      executionTimeoutMs: 200,
      // The seller's ScheduleSign lands; the schedule's own transfer then fails for want of funds.
      submit: async () => ({ status: "SUCCESS" }),
    });
    const entry = rail.challenge(HELD_OFFER, { resource: "http://hub.test/offers/x/call", now: NOW });
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: entry,
      payload: { scheduleId: NEW_SCHEDULE, createTxId: OLD_CREATE_TX },
    };

    let reportedPaid = false;
    const verified = await rail.verify(payment, entry);
    if (verified.isValid) {
      const settled = await rail.settle(payment, entry);
      if (settled.success) {
        const sign = new ScheduleSignTransaction()
          .setScheduleId(NEW_SCHEDULE)
          .setTransactionId(TransactionId.generate(AccountId.fromString(PAYEE)))
          .setNodeAccountIds([NODE])
          .freeze();
        const countersign = Buffer.from(sign.toBytes()).toString("base64");
        const released = await rail.escrow.release(
          heldJobId(OLD_CREATE_TX),
          `0x${"11".repeat(32)}` as Hex,
          `0x${"22".repeat(32)}` as Hex,
          countersign,
        );
        reportedPaid = released.success;
      }
    }
    expect(reportedPaid).toBe(false);
  });
});
