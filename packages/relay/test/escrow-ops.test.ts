import { describe, expect, test } from "bun:test";
import { getAddress, recoverTypedDataAddress } from "viem";
import type { Hex } from "viem";
import { cancelTypedData, releaseTypedData } from "@countersign/core";
import { settleCountersign } from "../src/countersign-scheme.ts";
import { cancelJob, jobStatus, refundJob, releaseJob } from "../src/escrow-ops.ts";
import { refundPayment } from "../src/refund.ts";
import { signRefund } from "../src/merchant.ts";
import { txUrl } from "../src/chain.ts";
import { csContext, makeCountersignBody } from "./escrow-support.ts";
import type { TestRelay } from "./escrow-support.ts";
import { NOW, createTestRelay } from "./support.ts";

const SLIP: Hex = `0x${"51".repeat(32)}`;

async function funded(relay: TestRelay) {
  const made = await makeCountersignBody(relay);
  const result = await settleCountersign(made.body, csContext(relay));
  expect(result.success).toBe(true);
  relay.chain.jobs.set(made.jobId.toLowerCase(), 1);
  return made;
}

describe("escrow ops", () => {
  test("release closes the job as released", async () => {
    const relay = createTestRelay();
    const { jobId, escrow } = await funded(relay);
    const sig = await relay.merchant.signTypedData(releaseTypedData(1874, escrow, jobId, SLIP));
    const result = await releaseJob({ jobId, slipHash: SLIP, sellerSig: sig }, csContext(relay));
    expect(result.ok).toBe(true);
    const job = relay.ledger.getJob(jobId)!;
    expect(job.status).toBe("released");
    expect(job.slipHash).toBe(SLIP);
    if (result.ok) {
      expect(job.closeTx).toBe(result.transaction);
      expect(result.url).toBe(txUrl(result.transaction));
      expect(result.status).toBe("released");
    }
    expect(relay.chain.writes.at(-1)!.functionName).toBe("release");
  });

  test("cancel closes the job as cancelled", async () => {
    const relay = createTestRelay();
    const { jobId, escrow } = await funded(relay);
    const sig = await relay.merchant.signTypedData(cancelTypedData(1874, escrow, jobId));
    const result = await cancelJob({ jobId, sellerSig: sig }, csContext(relay));
    expect(result.ok).toBe(true);
    expect(relay.ledger.getJob(jobId)!.status).toBe("cancelled");
    expect(relay.chain.writes.at(-1)!.functionName).toBe("cancel");
  });

  test("refund closes the job as refunded", async () => {
    const relay = createTestRelay();
    const { jobId } = await funded(relay);
    const result = await refundJob({ jobId }, csContext(relay));
    expect(result.ok).toBe(true);
    expect(relay.ledger.getJob(jobId)!.status).toBe("refunded");
    expect(relay.chain.writes.at(-1)!.functionName).toBe("refund");
  });

  test("a closed job cannot be closed twice", async () => {
    const relay = createTestRelay();
    const { jobId } = await funded(relay);
    await refundJob({ jobId }, csContext(relay));
    const writes = relay.chain.writes.length;
    expect(await refundJob({ jobId }, csContext(relay))).toEqual({ ok: false, reason: "job_not_open" });
    expect(relay.chain.writes).toHaveLength(writes);
  });

  test("an unknown job is job_not_found", async () => {
    const relay = createTestRelay();
    const jobId: Hex = `0x${"99".repeat(32)}`;
    expect(await refundJob({ jobId }, csContext(relay))).toEqual({ ok: false, reason: "job_not_found" });
    expect(await cancelJob({ jobId, sellerSig: "0x00" }, csContext(relay))).toEqual({ ok: false, reason: "job_not_found" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("a job funded on chain but missing from the ledger can still be closed", async () => {
    const relay = createTestRelay();
    const jobId: Hex = `0x${"98".repeat(32)}`;
    relay.chain.jobs.set(jobId, 1);
    const result = await refundJob({ jobId }, csContext(relay));
    expect(result.ok).toBe(true);
    expect(relay.chain.writes).toHaveLength(1);
  });

  test("a simulation failure writes nothing and leaves the job funded", async () => {
    const relay = createTestRelay();
    const { jobId } = await funded(relay);
    const writes = relay.chain.writes.length;
    relay.chain.failSimulation = true;
    const result = await refundJob({ jobId }, csContext(relay));
    expect(result).toEqual({ ok: false, reason: "simulation_failed" });
    expect(relay.chain.writes).toHaveLength(writes);
    expect(relay.ledger.getJob(jobId)!.status).toBe("funded");
  });

  test("a bad seller signature fails in simulation and spends nothing", async () => {
    const relay = createTestRelay();
    const { jobId, escrow } = await funded(relay);
    const forged = await relay.buyer.signTypedData(cancelTypedData(1874, escrow, jobId));
    const signer = await recoverTypedDataAddress({ ...cancelTypedData(1874, escrow, jobId), signature: forged });
    // Stand in for the contract: cancel() reverts unless the Cancel signer is the job's payee.
    relay.chain.simulateHook = (call) => {
      if (call.functionName === "cancel" && getAddress(signer) !== getAddress(relay.merchant.address)) {
        throw new Error("execution reverted: bad seller signature");
      }
    };
    const writes = relay.chain.writes.length;
    const bad = await cancelJob({ jobId, sellerSig: forged }, csContext(relay));
    expect(bad).toEqual({ ok: false, reason: "simulation_failed" });
    expect(relay.chain.writes).toHaveLength(writes);
    expect(relay.ledger.getJob(jobId)!.status).toBe("funded");
  });

  test("jobStatus merges the chain and the ledger", async () => {
    const relay = createTestRelay();
    const { jobId } = await funded(relay);
    const view = await jobStatus(jobId, csContext(relay));
    expect(view?.chain).toBe("funded");
    expect(view?.job?.status).toBe("funded");
    expect(await jobStatus(`0x${"77".repeat(32)}`, csContext(relay))).toBeNull();
  });

  test("a released job refunds through the gasless transfer path", async () => {
    const relay = createTestRelay();
    const { jobId, buyer, escrow } = await funded(relay);
    const sig = await relay.merchant.signTypedData(releaseTypedData(1874, escrow, jobId, SLIP));
    await releaseJob({ jobId, slipHash: SLIP, sellerSig: sig }, csContext(relay));
    relay.chain.setBalance(relay.merchant.address, 5_000_000n);

    const signed = await signRefund({
      merchant: relay.merchant,
      payment: { payer: buyer.address, payTo: relay.merchant.address, amount: 1_500_000n, refunded: 0n },
      amount: 500_000n,
      now: NOW,
    });
    const result = await refundPayment({ paymentId: jobId, ...signed }, relay.ctx);
    expect(result.ok).toBe(true);
    expect(relay.ledger.refundable(jobId)).toBe(1_000_000n);
    expect(relay.ledger.getOrder(jobId)!.status).toBe("partially_refunded");
    expect(relay.chain.writes.at(-1)!.functionName).toBe("transferWithAuthorization");
  });
});
