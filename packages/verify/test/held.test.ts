/**
 * A held Hedera slip is checked as what it is: the buyer's schedule, created and executed,
 * moving exactly the slip's amount to the slip's payee — read from a fake mirror, never the network.
 */

import { describe, expect, test } from "bun:test";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  canonicalHash,
  type PaymentPayload,
  type Slip,
  type SlipBody,
  slipBodyFor,
  slipHash,
  slipTypedData,
} from "@countersign/core";
import { verifySlip } from "../src/verify.ts";

const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const OFFER = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const BUYER = "0.0.11337064";
const PAY_TO = "0.0.11338176";
const ASSET = "0.0.429274";
const AMOUNT = "30000";
const SCHEDULE_ID = "0.0.11340633";
const CREATE_TX = "0.0.11337064@1793976332.854132797";
const EXECUTED = "1793976347.287046943";
const MIRROR = "https://testnet.mirrornode.hedera.com";
const MIRROR_ID = "0.0.11337064-1793976332-854132797";

const CREATE_URL = `${MIRROR}/api/v1/transactions/${MIRROR_ID}`;
const SCHEDULE_URL = `${MIRROR}/api/v1/schedules/${SCHEDULE_ID}`;
const EXECUTION_URL = `${CREATE_URL}?scheduled=true`;

const DEFAULT_CREATE = {
  transactions: [
    { transaction_id: MIRROR_ID, name: "SCHEDULECREATE", entity_id: SCHEDULE_ID, result: "SUCCESS" },
  ],
};

const DEFAULT_SCHEDULE = { schedule_id: SCHEDULE_ID, executed_timestamp: EXECUTED };

function defaultExecution(): unknown {
  return {
    transactions: [
      {
        result: "SUCCESS",
        consensus_timestamp: EXECUTED,
        token_transfers: [
          { token_id: ASSET, account: BUYER, amount: -30000 },
          { token_id: ASSET, account: PAY_TO, amount: 30000 },
        ],
      },
    ],
  };
}

function baseBody(): SlipBody {
  return slipBodyFor(
    {
      jobId: keccak256(toBytes(CREATE_TX)),
      offerHash: OFFER,
      input: { q: 1 },
      rail: "hedera-scheduled",
      network: "hedera:testnet",
      buyer: BUYER,
      payTo: PAY_TO,
      asset: ASSET,
      amount: AMOUNT,
      deadline: 1_793_976_600,
      lineage: [],
    },
    seller.address,
    canonicalHash({ q: 1 }),
    canonicalHash({ a: 2 }),
    1_793_976_340,
  );
}

function heldPayment(payload: Record<string, unknown> = { scheduleId: SCHEDULE_ID, createTxId: CREATE_TX }): PaymentPayload {
  return {
    x402Version: 2,
    accepted: {
      scheme: "countersign",
      network: "hedera:testnet",
      amount: AMOUNT,
      asset: ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: "hedera-scheduled", offerHash: OFFER, holdSeconds: 300 },
    },
    payload,
  };
}

const exactPayment: PaymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "hedera:testnet",
    amount: AMOUNT,
    asset: ASSET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 120,
  },
  payload: { transaction: "AAECAwQ=" },
};

const heldSettlement: Slip["settlement"] = { transaction: CREATE_TX, network: "hedera:testnet" };

async function signedSlip(
  body: SlipBody,
  payment: PaymentPayload,
  settlement: Slip["settlement"],
): Promise<Slip> {
  return {
    body,
    hash: slipHash(body),
    sellerSig: await seller.signTypedData(slipTypedData(body)),
    payment,
    settlement,
  };
}

async function heldSlip(
  opts: {
    body?: Partial<SlipBody>;
    payment?: PaymentPayload;
    settlement?: Slip["settlement"];
  } = {},
): Promise<Slip> {
  return signedSlip(
    { ...baseBody(), ...opts.body },
    opts.payment ?? heldPayment(),
    opts.settlement ?? heldSettlement,
  );
}

interface MirrorBodies {
  create?: unknown;
  schedule?: unknown;
  execution?: unknown;
}

function fakeMirror(bodies: MirrorBodies = {}): typeof fetch {
  const routes = new Map<string, unknown>([
    [CREATE_URL, bodies.create ?? DEFAULT_CREATE],
    [SCHEDULE_URL, bodies.schedule ?? DEFAULT_SCHEDULE],
    [EXECUTION_URL, bodies.execution ?? defaultExecution()],
  ]);
  const fake = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!routes.has(url)) return new Response("not found", { status: 404 });
    return Response.json(routes.get(url));
  };
  return fake as typeof fetch;
}

describe("a held Hedera slip", () => {
  test("verifies offline and says the mirror was not read", async () => {
    const verdict = await verifySlip(await heldSlip());
    expect(verdict.valid).toBe(true);
    const finding = verdict.findings.find((f) => f.check === "countersignature")!;
    expect(finding.ok).toBe(true);
    expect(finding.detail).toBe(
      `held by Hedera schedule ${SCHEDULE_ID}, created by ${CREATE_TX}; the seller's countersignature released it`,
    );
    expect(verdict.findings.some((f) => f.check === "onchain")).toBe(false);
    expect(verdict.skipped).toEqual([
      "onchain: not checked. Pass a Hedera mirror URL (--mirror) to read the schedule's execution.",
    ]);
  });

  test("an exact Hedera slip beside it verifies by its settlement", async () => {
    const verdict = await verifySlip(
      await heldSlip({
        payment: exactPayment,
        settlement: { transaction: "0.0.11337064@1793976400.123456789", network: "hedera:testnet" },
      }),
    );
    expect(verdict.valid).toBe(true);
    expect(verdict.findings.find((f) => f.check === "countersignature")!.ok).toBe(true);
  });

  test("the mirror proves the schedule executed exactly", async () => {
    const verdict = await verifySlip(await heldSlip(), { mirrorUrl: MIRROR, fetch: fakeMirror() });
    expect(verdict.valid).toBe(true);
    expect(verdict.skipped).toEqual([]);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(true);
    expect(finding.detail).toBe(
      `schedule ${SCHEDULE_ID} executed at ${EXECUTED}: ${AMOUNT} of ${ASSET} from ${BUYER} to ${PAY_TO}`,
    );
  });
});

describe("a held slip's countersignature", () => {
  test("is refused when the payment names no schedule", async () => {
    const verdict = await verifySlip(
      await heldSlip({ payment: heldPayment({ createTxId: CREATE_TX }) }),
    );
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "countersignature")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("the held payment names no schedule");
  });

  test("is refused when the settlement is not the schedule's create", async () => {
    const other = "0.0.11337064@1793976400.000000000";
    const verdict = await verifySlip(
      await heldSlip({ settlement: { transaction: other, network: "hedera:testnet" } }),
    );
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "countersignature")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(`the slip's settlement ${other} is not the schedule's create ${CREATE_TX}`);
  });

  test("is refused when the job is not the schedule the payment names", async () => {
    const otherJob = keccak256(toBytes("0.0.11337064@1793979999.000000000"));
    const verdict = await verifySlip(await heldSlip({ body: { jobId: otherJob } }));
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "countersignature")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(
      `the seller signed job ${otherJob}, not the job this schedule paid (${keccak256(toBytes(CREATE_TX))})`,
    );
  });
});

describe("a held slip's mirror", () => {
  test("refuses a create for another schedule", async () => {
    const create = {
      transactions: [
        { name: "SCHEDULECREATE", entity_id: "0.0.99999999", result: "SUCCESS" },
      ],
    };
    const verdict = await verifySlip(await heldSlip(), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror({ create }),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("not the buyer's create of this schedule");
  });

  test("refuses a create whose account is not the buyer", async () => {
    const verdict = await verifySlip(await heldSlip({ body: { buyer: "0.0.11399999" } }), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror(),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("not the buyer's create of this schedule");
  });

  test("refuses a schedule that has not executed", async () => {
    const schedule = { schedule_id: SCHEDULE_ID, executed_timestamp: null };
    const verdict = await verifySlip(await heldSlip(), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror({ schedule }),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("the schedule has not executed");
  });

  test("refuses an execution at another consensus time", async () => {
    const execution = {
      transactions: [
        {
          result: "SUCCESS",
          consensus_timestamp: "1793976348.000000000",
          token_transfers: [
            { token_id: ASSET, account: BUYER, amount: -30000 },
            { token_id: ASSET, account: PAY_TO, amount: 30000 },
          ],
        },
      ],
    };
    const verdict = await verifySlip(await heldSlip(), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror({ execution }),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("the schedule's execution record is missing");
  });

  test("refuses an execution that moved 29999", async () => {
    const execution = {
      transactions: [
        {
          result: "SUCCESS",
          consensus_timestamp: EXECUTED,
          token_transfers: [
            { token_id: ASSET, account: BUYER, amount: -29999 },
            { token_id: ASSET, account: PAY_TO, amount: 29999 },
          ],
        },
      ],
    };
    const verdict = await verifySlip(await heldSlip(), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror({ execution }),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("the execution moved a different amount or payee");
  });

  test("refuses an execution that paid another account", async () => {
    const execution = {
      transactions: [
        {
          result: "SUCCESS",
          consensus_timestamp: EXECUTED,
          token_transfers: [
            { token_id: ASSET, account: BUYER, amount: -30000 },
            { token_id: ASSET, account: "0.0.11349999", amount: 30000 },
          ],
        },
      ],
    };
    const verdict = await verifySlip(await heldSlip(), {
      mirrorUrl: MIRROR,
      fetch: fakeMirror({ execution }),
    });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain")!;
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe("the execution moved a different amount or payee");
  });
});
