import type { Order } from "./model.ts";

/*
 * Sample rows for escrow v2's review states (docs/spec/escrow.md, 'Escrow v2'). Not live anywhere
 * yet: fixtures.ts imports this only on the dev server, so no production build carries it.
 */

const MERCHANT = "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c";
const CUSTOMER = "0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298";
const NOW = Date.now();
const MINUTE = 60_000;

/** A made-up hash: 0x and a four-character "e" seed sixteen times, which isStandIn recognises. */
function made(seed: string): string {
  return `0x${seed.repeat(16)}`;
}

export function reviewSamples(): Order[] {
  const v2 = { kind: "escrow" as const, customer: CUSTOMER, merchant: MERCHANT, refunded: "0", refundTxs: [] };
  return [
    {
      ...v2,
      id: made("e101"),
      amount: "200000",
      fee: "0",
      refundable: "200000",
      status: "in_review",
      closeKind: null,
      createdAt: NOW - 3 * MINUTE,
      receivedAt: null,
      settleTx: made("e102"),
      closeTx: null,
      slipHash: made("e103"),
      deadline: NOW + 30 * MINUTE,
      reviewWindow: 300,
      deliveredAt: NOW - MINUTE,
      reviewEndsAt: NOW + 4 * MINUTE,
      description: "Translation, 900 words",
    },
    {
      ...v2,
      id: made("e201"),
      amount: "200000",
      fee: "2000",
      refundable: "200000",
      status: "paid",
      closeKind: "release",
      createdAt: NOW - 25 * MINUTE,
      deliveredAt: NOW - 22 * MINUTE,
      reviewEndsAt: NOW - 17 * MINUTE,
      reviewWindow: 300,
      acceptedAt: NOW - 20 * MINUTE,
      acceptTx: made("e204"),
      receivedAt: NOW - 20 * MINUTE,
      closedAt: NOW - 20 * MINUTE,
      settleTx: made("e202"),
      closeTx: made("e204"),
      slipHash: made("e203"),
      description: "Logo vectorisation",
    },
    {
      ...v2,
      id: made("e301"),
      amount: "150000",
      fee: "1500",
      refundable: "150000",
      status: "paid",
      closeKind: "release",
      releasedAfterWindow: true,
      createdAt: NOW - 45 * MINUTE,
      deliveredAt: NOW - 40 * MINUTE,
      reviewEndsAt: NOW - 35 * MINUTE,
      reviewWindow: 300,
      receivedAt: NOW - 35 * MINUTE + 5_000,
      closedAt: NOW - 35 * MINUTE + 5_000,
      settleTx: made("e302"),
      closeTx: made("e304"),
      slipHash: made("e303"),
      description: "Data cleanup, 2,000 rows",
    },
    {
      ...v2,
      id: made("e401"),
      amount: "300000",
      fee: "0",
      refundable: "0",
      status: "refunded",
      closeKind: "dispute_refund",
      createdAt: NOW - 55 * MINUTE,
      deliveredAt: NOW - 52 * MINUTE,
      reviewEndsAt: NOW - 47 * MINUTE,
      reviewWindow: 300,
      disputedAt: NOW - 50 * MINUTE,
      disputeTx: made("e404"),
      receivedAt: null,
      closedAt: NOW - 50 * MINUTE,
      settleTx: made("e402"),
      closeTx: made("e404"),
      slipHash: made("e403"),
      description: "Market summary",
    },
    {
      ...v2,
      id: made("e501"),
      amount: "100000",
      fee: "0",
      refundable: "0",
      status: "refunded",
      closeKind: "delivery_failed",
      bondSlashed: "100000",
      createdAt: NOW - 75 * MINUTE,
      receivedAt: null,
      closedAt: NOW - 70 * MINUTE,
      settleTx: made("e502"),
      closeTx: made("e504"),
      reviewWindow: 0,
      description: "PDF to table",
    },
  ];
}

