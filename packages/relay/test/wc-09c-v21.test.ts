/**
 * Escrow v2.1 on the relay: fund takes the payee's Lock, verify skips the fund simulation for a
 * bonded job, dispute carries the status the buyer signed, and cancel no longer closes a
 * delivered job. The chain is simulated; nothing here reaches a network.
 */

import { describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  type CountersignExtra,
  type CountersignTerms,
  jobIdOf,
  type Offer,
  offerHash,
} from "@countersign/core";
import { whitechainRail } from "@countersign/rail";
import { settleCountersign, verifyCountersign } from "../src/countersign-scheme.ts";
import { cancelJob, releaseJob } from "../src/escrow-ops.ts";
import { createRelayApp } from "../src/server.ts";
import type { SimulationCall } from "../src/ports.ts";
import { csContext, makeOffer } from "./escrow-support.ts";
import { createTestRelay, NOW } from "./support.ts";

const V2 = getAddress("0x7777777777777777777777777777777777777777");
const SIG: Hex = `0x${"34".repeat(65)}`;
const LOCK: Hex = `0x${"56".repeat(65)}`;
const SLIP: Hex = `0x${"51".repeat(32)}`;

type TestRelay = ReturnType<typeof createTestRelay>;

let salt = 0;

/** Both escrows allowed, with review and bond reads simulated. */
function withV2(relay: TestRelay) {
  relay.policy.allowedEscrows.push(V2);
  relay.policy.escrowV2 = V2;
  const reviews = new Map<string, readonly [bigint, bigint, bigint]>();
  const read = relay.chain.readContract.bind(relay.chain);
  relay.chain.readContract = async (call) => {
    const jobId = String(call.args?.[0] ?? "").toLowerCase();
    if (call.functionName === "reviewOf") return reviews.get(jobId) ?? [0n, 0n, 0n];
    if (call.functionName === "bondOfJob") return 0n;
    if (call.functionName === "tollBps") return 100n;
    return read(call);
  };
  return { reviews };
}

async function makeV2Body(
  relay: TestRelay,
  options: { bond?: string; reviewWindow?: number; lockSig?: Hex } = {},
) {
  const buyer = privateKeyToAccount(generatePrivateKey());
  relay.chain.setBalance(buyer.address, 100_000_000n);
  const offer: Offer = {
    ...makeOffer(relay.merchant.address),
    bond: options.bond ?? "0",
    ...(options.reviewWindow !== undefined ? { reviewWindow: options.reviewWindow } : {}),
  };
  const rail = whitechainRail({ relayUrl: "http://relay", version: 2, escrow: V2 });
  const req = rail.challenge(offer, { resource: "http://merchant.example/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra & { bond?: string; reviewWindow?: number };
  salt += 1;
  const terms: CountersignTerms = {
    offerHash: offerHash(offer),
    buyer: buyer.address,
    payee: getAddress(req.payTo),
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: String(salt),
    bond: extra.bond ?? "0",
    reviewWindow: extra.reviewWindow ?? 0,
  };
  const input = {
    terms,
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: getAddress(req.asset),
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const jobId: Hex = jobIdOf(terms, extra.chainId, extra.escrow);
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      accepted: req,
      payload: payload as unknown as Record<string, unknown>,
      resource: { url: "http://merchant.example/x" },
    },
    paymentRequirements: req,
    ...(options.lockSig ? { lockSig: options.lockSig } : {}),
  };
  return { body, buyer, jobId };
}

async function fundedV2(relay: TestRelay, options: { bond?: string; reviewWindow?: number } = {}) {
  const made = await makeV2Body(relay, options);
  const result = await settleCountersign(made.body, csContext(relay));
  expect(result.success).toBe(true);
  return made;
}

function appFor(relay: TestRelay) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
  });
}

function post(app: ReturnType<typeof createRelayApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("fund with a Lock", () => {
  test("a bonded v2 settle sends the Lock as fund's third argument", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const made = await makeV2Body(relay, { bond: "500000", lockSig: LOCK });

    const result = await settleCountersign(made.body, csContext(relay));

    expect(result.success).toBe(true);
    const write = relay.chain.writes.at(-1)!;
    expect(write.address).toBe(V2);
    expect(write.functionName).toBe("fund");
    expect((write.args as readonly unknown[])[2]).toBe(LOCK);
  });

  test("an unbonded v2 settle sends 0x", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const made = await makeV2Body(relay, { bond: "0" });

    const result = await settleCountersign(made.body, csContext(relay));

    expect(result.success).toBe(true);
    const write = relay.chain.writes.at(-1)!;
    expect(write.functionName).toBe("fund");
    expect((write.args as readonly unknown[])[2]).toBe("0x");
  });

  test("a bonded v2 settle without a Lock is lock_missing with no simulate and no submit", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const made = await makeV2Body(relay, { bond: "500000" });
    let simulations = 0;
    relay.chain.simulateHook = () => {
      simulations += 1;
    };

    const result = await settleCountersign(made.body, csContext(relay));

    expect(result).toMatchObject({ success: false, errorReason: "lock_missing", transaction: "" });
    expect(simulations).toBe(0);
    expect(relay.chain.writes).toHaveLength(0);
  });
});

describe("verify never asks for the Lock", () => {
  test("a bonded v2 job verifies without simulating fund", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const made = await makeV2Body(relay, { bond: "500000" });
    const simulations: SimulationCall[] = [];
    relay.chain.simulateHook = (call) => {
      simulations.push(call);
    };

    expect(await verifyCountersign(made.body, csContext(relay))).toEqual({
      isValid: true,
      payer: getAddress(made.buyer.address),
    });
    expect(simulations).toHaveLength(0);
  });

  test("an unbonded v2 job verifies by simulating with 0x", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const made = await makeV2Body(relay, { bond: "0" });
    const simulations: SimulationCall[] = [];
    relay.chain.simulateHook = (call) => {
      simulations.push(call);
    };

    expect((await verifyCountersign(made.body, csContext(relay))).isValid).toBe(true);
    expect(simulations).toHaveLength(1);
    expect(simulations[0]!.functionName).toBe("fund");
    expect((simulations[0]!.args as readonly unknown[])[2]).toBe("0x");
  });
});

describe("dispute carries the status", () => {
  test("a missing or invalid status is 400", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const app = appFor(relay);
    const jobId = `0x${"12".repeat(32)}`;
    for (const status of [undefined, "5", -1, 256, 1.5, null]) {
      const body = status === undefined ? { jobId, buyerSig: SIG } : { jobId, buyerSig: SIG, status };
      const res = await post(app, "/escrow/dispute", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, reason: "invalid_payload" });
    }
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("the call carries [jobId, status, buyerSig]", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay, { bond: "0" });

    const res = await post(appFor(relay), "/escrow/dispute", { jobId, status: 1, buyerSig: SIG });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "disputed" });
    const write = relay.chain.writes.at(-1)!;
    expect(write.functionName).toBe("dispute");
    expect(write.args).toEqual([jobId, 1, SIG]);
  });
});

describe("cancel only closes a funded job", () => {
  test("a delivered v2 job answers 422 job_not_open with no call", async () => {
    const relay = createTestRelay();
    const reads = withV2(relay);
    const made = await fundedV2(relay, { bond: "0", reviewWindow: 300 });
    reads.reviews.set(made.jobId.toLowerCase(), [300n, BigInt(NOW), BigInt(NOW + 300)]);
    await releaseJob({ jobId: made.jobId, slipHash: SLIP, sellerSig: SIG }, csContext(relay));
    expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");
    const writes = relay.chain.writes.length;

    const res = await post(appFor(relay), "/escrow/cancel", { jobId: made.jobId, sellerSig: SIG });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, reason: "job_not_open" });
    expect(relay.chain.writes).toHaveLength(writes);
    expect(relay.ledger.getJob(made.jobId)!.status).toBe("delivered");
  });

  test("a funded v2 job still cancels", async () => {
    const relay = createTestRelay();
    withV2(relay);
    const { jobId } = await fundedV2(relay, { bond: "0" });

    const result = await cancelJob({ jobId, sellerSig: SIG }, csContext(relay));

    expect(result).toMatchObject({ ok: true, status: "cancelled" });
    expect(relay.chain.writes.at(-1)!.functionName).toBe("cancel");
  });
});
