import { describe, expect, test } from "bun:test";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalHash, type PaymentPayload, type Slip, slipBodyFor, slipHash, slipTypedData } from "@countersign/core";
import { verifySlip } from "../src/verify.ts";

// cs-w1 adversarial test. A failing test here is a blocker.
// A held slip's payment and settlement sit outside the seller-signed body. The body names the job
// (jobId = keccak256(createTxId)); nothing ties the payment's schedule to it. So a slip for a job whose
// own schedule never executed verifies as paid when it carries another executed schedule between the
// same buyer and seller for the same amount, e.g. the buyer's earlier purchase. Ratings count such slips.

const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const OFFER = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const BUYER = "0.0.11337064";
const PAY_TO = "0.0.11338176";
const ASSET = "0.0.429274";
const AMOUNT = "30000";
const MIRROR = "https://testnet.mirrornode.hedera.com";

// The schedule that really executed (an earlier purchase), and the job this slip is for, whose own
// schedule never ran.
const PAID_SCHEDULE = "0.0.11340633";
const PAID_CREATE = "0.0.11337064@1793976332.854132797";
const PAID_MIRROR_ID = "0.0.11337064-1793976332-854132797";
const EXECUTED = "1793976347.287046943";
const UNPAID_CREATE = "0.0.11337064@1793979000.000000001";

function fakeMirror(): typeof fetch {
  const create = `${MIRROR}/api/v1/transactions/${PAID_MIRROR_ID}`;
  const routes = new Map<string, unknown>([
    [create, { transactions: [{ transaction_id: PAID_MIRROR_ID, name: "SCHEDULECREATE", entity_id: PAID_SCHEDULE, result: "SUCCESS" }] }],
    [`${MIRROR}/api/v1/schedules/${PAID_SCHEDULE}`, { schedule_id: PAID_SCHEDULE, executed_timestamp: EXECUTED }],
    [
      `${create}?scheduled=true`,
      {
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
      },
    ],
  ]);
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return routes.has(url) ? Response.json(routes.get(url)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("W1 B22: a held slip verifies against a payment that is not its job's", () => {
  test("a slip whose job never ran is not proved paid by another schedule's execution", async () => {
    const body = slipBodyFor(
      {
        jobId: keccak256(toBytes(UNPAID_CREATE)),
        offerHash: OFFER,
        input: { q: 1 },
        rail: "hedera-scheduled",
        network: "hedera:testnet",
        buyer: BUYER,
        payTo: PAY_TO,
        asset: ASSET,
        amount: AMOUNT,
        deadline: 1_793_979_300,
        lineage: [],
      },
      seller.address,
      canonicalHash({ q: 1 }),
      canonicalHash({ a: 2 }),
      1_793_979_010,
    );
    const payment: PaymentPayload = {
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
      payload: { scheduleId: PAID_SCHEDULE, createTxId: PAID_CREATE },
    };
    const slip: Slip = {
      body,
      hash: slipHash(body),
      sellerSig: await seller.signTypedData(slipTypedData(body)),
      payment,
      settlement: { transaction: PAID_CREATE, network: "hedera:testnet" },
    };

    const verdict = await verifySlip(slip, { mirrorUrl: MIRROR, fetch: fakeMirror() });
    expect(verdict.valid).toBe(false);
  });
});
