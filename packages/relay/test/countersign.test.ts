import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { settleCountersign, verifyCountersign } from "../src/countersign-scheme.ts";
import { NETWORK } from "../src/chain.ts";
import { clone, csContext, makeCountersignBody } from "./escrow-support.ts";
import { createTestRelay } from "./support.ts";

describe("verifyCountersign", () => {
  test("accepts a valid countersignature", async () => {
    const relay = createTestRelay();
    const { body, buyer } = await makeCountersignBody(relay);
    expect(await verifyCountersign(body, csContext(relay))).toEqual({ isValid: true, payer: getAddress(buyer.address) });
  });

  test("a moved price carries the rail's refusal copy", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const moved = clone(body);
    moved.paymentRequirements.amount = "2000000";
    moved.paymentPayload.accepted.amount = "2000000";
    expect(await verifyCountersign(moved, csContext(relay))).toEqual({
      isValid: false,
      invalidReason: "Refused. The price moved after you signed.",
    });
  });

  test("refuses an escrow that is not on the allowlist", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const other = clone(body);
    const stranger = "0x3333333333333333333333333333333333333333";
    (other.paymentRequirements.extra as { escrow: string }).escrow = stranger;
    (other.paymentPayload.accepted.extra as { escrow: string }).escrow = stranger;
    expect(await verifyCountersign(other, csContext(relay))).toEqual({ isValid: false, invalidReason: "invalid_payload" });
  });

  test("refuses the wrong network and the wrong scheme", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const network = clone(body);
    network.paymentRequirements.network = "eip155:5042002";
    expect(await verifyCountersign(network, csContext(relay))).toEqual({ isValid: false, invalidReason: "invalid_network" });
    const scheme = clone(body);
    scheme.paymentRequirements.scheme = "exact";
    expect(await verifyCountersign(scheme, csContext(relay))).toEqual({ isValid: false, invalidReason: "invalid_scheme" });
  });

  test("refuses a body that is not x402 v2", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    expect(await verifyCountersign({ ...body, x402Version: 1 }, csContext(relay))).toEqual({
      isValid: false,
      invalidReason: "invalid_payload",
    });
    expect((await verifyCountersign(null, csContext(relay))).isValid).toBe(false);
  });

  test("refuses when accepted differs from the requirements", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const mismatch = clone(body);
    mismatch.paymentPayload.accepted.payTo = "0x4444444444444444444444444444444444444444";
    expect(await verifyCountersign(mismatch, csContext(relay))).toEqual({ isValid: false, invalidReason: "invalid_payload" });
  });

  test("a failed simulation is invalid_transaction_state", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    relay.chain.failSimulation = true;
    expect(await verifyCountersign(body, csContext(relay))).toEqual({
      isValid: false,
      invalidReason: "invalid_transaction_state",
    });
  });
});

describe("settleCountersign", () => {
  test("funds the escrow and records the job", async () => {
    const relay = createTestRelay();
    const { body, buyer, jobId, escrow } = await makeCountersignBody(relay);
    const result = await settleCountersign(body, csContext(relay));
    expect(result.success).toBe(true);
    expect(result.jobId).toBe(jobId);
    expect(result.network).toBe(NETWORK);
    expect(relay.chain.writes).toHaveLength(1);
    expect(relay.chain.writes[0]!.functionName).toBe("fund");
    expect(relay.chain.writes[0]!.address).toBe(escrow);
    const job = relay.ledger.getJob(jobId)!;
    expect(job.status).toBe("funded");
    expect(job.fundTx).toBe(result.transaction);
    expect(job.buyer).toBe(getAddress(buyer.address));
    expect(job.payee).toBe(getAddress(relay.merchant.address));
    expect(job.amount).toBe(1_500_000n);
    expect(job.resource).toBe("http://merchant.example/x");
  });

  test("settling the same payment twice returns the same transaction", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const first = await settleCountersign(body, csContext(relay));
    const second = await settleCountersign(body, csContext(relay));
    expect(second.success).toBe(true);
    expect(second.transaction).toBe(first.transaction);
    expect(relay.chain.writes).toHaveLength(1);
  });

  test("a receipt timeout leaves a pending job and answers settlement_pending", async () => {
    const relay = createTestRelay();
    const { body, jobId } = await makeCountersignBody(relay);
    relay.chain.timeoutReceipt = true;
    const first = await settleCountersign(body, csContext(relay));
    expect(first.success).toBe(false);
    expect(first.errorReason).toBe("settlement_pending");
    expect(relay.ledger.getJob(jobId)!.status).toBe("pending");
    const again = await settleCountersign(body, csContext(relay));
    expect(again.errorReason).toBe("settlement_pending");
    expect(again.transaction).toBe(first.transaction);
    expect(relay.chain.writes).toHaveLength(1);
  });

  test("an invalid payment spends nothing", async () => {
    const relay = createTestRelay();
    const { body } = await makeCountersignBody(relay);
    const moved = clone(body);
    moved.paymentRequirements.amount = "2000000";
    moved.paymentPayload.accepted.amount = "2000000";
    const result = await settleCountersign(moved, csContext(relay));
    expect(result).toEqual({
      success: false,
      errorReason: "Refused. The price moved after you signed.",
      transaction: "",
      network: NETWORK,
    });
    expect(relay.chain.writes).toHaveLength(0);
  });
});
