import { describe, expect, test } from "bun:test";
import type { Client } from "@hiero-ledger/sdk";
import { USDC_TESTNET } from "../constants.ts";
import { countersignSchedule, type ExpectedScheduledTransfer } from "../schedule.ts";
import { OFFER_HASH, PAYEE, PAYER } from "./fixtures.ts";

const want: ExpectedScheduledTransfer = {
  asset: USDC_TESTNET,
  amount: 10000n,
  payTo: PAYEE,
  offerHash: OFFER_HASH,
  payer: PAYER,
};

function mirrorRecords(record: object) {
  const fetch = (async () =>
    Response.json(record)) as unknown as typeof globalThis.fetch;
  return { base: "http://mirror.test", fetch };
}

function record(over: Record<string, unknown> = {}) {
  return {
    schedule_id: "0.0.500",
    creator_account_id: PAYER,
    payer_account_id: PAYER,
    memo: "",
    executed_timestamp: null,
    expiration_time: "9999999999.000000000",
    deleted: false,
    wait_for_expiry: false,
    transaction_body: "",
    signatures: [],
    ...over,
  };
}

/** A seller client that records any use and fails the test if the sign transaction is reached. */
function sellerClient() {
  const calls: string[] = [];
  const client = new Proxy(
    {},
    {
      get(_target, property) {
        const name = String(property);
        calls.push(name);
        throw new Error(`seller client used: ${name}`);
      },
    },
  ) as Client;
  return { client, calls };
}

describe("countersignSchedule refuses a schedule that would not pay now", () => {
  test("refuses a schedule that waits for its expiry, without signing", async () => {
    const seller = sellerClient();

    await expect(
      countersignSchedule(seller.client, "0.0.500", want, {
        ...mirrorRecords(record({ wait_for_expiry: true })),
        pollIntervalMs: 1,
        pollTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      name: "ScheduleRefusedError",
      reason: "wait_for_expiry",
      message: "Refused. The schedule waits for its expiry, so the seller's key would not pay now.",
    });
    expect(seller.calls).toEqual([]);
  });

  test("refuses a schedule whose fee payer is not the buyer, without signing", async () => {
    const seller = sellerClient();

    await expect(
      countersignSchedule(seller.client, "0.0.500", want, {
        ...mirrorRecords(record({ payer_account_id: "0.0.999" })),
        pollIntervalMs: 1,
        pollTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      name: "ScheduleRefusedError",
      reason: "payer_mismatch",
      message: "Refused. The schedule names a fee payer other than the buyer.",
    });
    expect(seller.calls).toEqual([]);
  });
});
