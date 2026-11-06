import type { Order, ReceiptOrder, RefundRecord, RelayStatus } from "./model.ts";
import { ordersCsv, txUrl } from "./model.ts";

/*
 * The sample ledger, for reviewing the screens with no hub (?hub=off). Loaded only by dynamic
 * import, so the default bundle never carries it.
 * Four are the real Whitechain Sepolia history of this merchant, so every proof link opens a
 * real transaction. The held order and the partly refunded one are made up, with hashes of
 * their own; no hash appears twice.
 */

const MERCHANT = "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c";
const CUSTOMER = "0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298";

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/*
 * Every hash this sample made up, rather than took from the chain. They are shown as plain text,
 * never as explorer links, because no explorer has them (STEER-1730).
 */
const STAND_INS = new Set<string>([
  "0x3b8f2a9c4d7e1f0a6b5c8d9e2f3a4b7c0d1e6f5a8b9c2d3e4f7a0b1c6d5e8f9a",
  "0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b",
  "0x2c4e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c",
]);

/** The review samples' made-up hashes, one pattern: 0x then a four-character "e" seed, sixteen times. */
const REVIEW_STAND_IN = /^0x(e[0-9]{3}){16}$/i;

export function isStandIn(hash: string): boolean {
  return STAND_INS.has(hash.toLowerCase()) || REVIEW_STAND_IN.test(hash);
}


export const fixtureMerchant = MERCHANT;

const baseOrders: Order[] = [
  {
    // Real: an agent bought a forecast over x402 through the drop-in paywall.
    id: "0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "50000",
    fee: "0",
    refunded: "0",
    refundable: "50000",
    status: "paid",
    closeKind: null,
    createdAt: NOW - 2 * MINUTE,
    receivedAt: NOW - 2 * MINUTE,
    settleTx: "0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07",
    closeTx: null,
    refundTxs: [],
    description: "Mumbai weather forecast",
  },
  {
    // Real: the whitechain-dev skill bought through the hub; the escrow released to the merchant.
    id: "0x01a66ebcdaa75420b747496de7e523ed0293ecf27d6733c56aead58719dcb231",
    kind: "escrow",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "50000",
    fee: "500",
    refunded: "0",
    refundable: "50000",
    status: "paid",
    closeKind: "release",
    createdAt: NOW - 9 * MINUTE,
    receivedAt: NOW - 9 * MINUTE + 4_000,
    closedAt: NOW - 9 * MINUTE + 4_000,
    settleTx: "0x415bddc897b459a2d2342809e1a2621ac3999ca1d5812b3670b563fce504b08c",
    closeTx: "0x90ed826a41f21290db924e4afc1e06bffe806e2966d8582618a074efa0c3c812",
    slipHash: "0x7f69ea83dd410372d0ec8eb178f7a45affd16f11f5865655381495afff5edf6c",
    refundTxs: [],
    offerHash: "0xc94049eb809dca1ee14d91cf69ee2f9d807aee085d0c14ba8422d65eaab21b7b",
    description: "whitechain-dev",
  },
  {
    // Made up: held in escrow until delivery.
    id: "0x7d1e0c4a5b9f3e8d2c6a1b0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
    kind: "escrow",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "400000",
    fee: "0",
    refunded: "0",
    refundable: "400000",
    status: "held",
    closeKind: null,
    createdAt: NOW - 18 * MINUTE,
    receivedAt: null,
    settleTx: "0x3b8f2a9c4d7e1f0a6b5c8d9e2f3a4b7c0d1e6f5a8b9c2d3e4f7a0b1c6d5e8f9a",
    closeTx: null,
    refundTxs: [],
    deadline: NOW + 25 * MINUTE,
    description: "Contract review, 2 files",
  },
  {
    // Made up: a direct payment, partly refunded.
    id: "0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "1000000",
    fee: "0",
    refunded: "250000",
    refundable: "750000",
    status: "partially_refunded",
    closeKind: null,
    createdAt: NOW - 52 * MINUTE,
    receivedAt: NOW - 52 * MINUTE,
    settleTx: "0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b",
    closeTx: null,
    refundTxs: ["0x2c4e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c"],
    description: "Licence renewal, 4 seats",
  },
  {
    // Real: the first gasless payment, refunded in one click.
    id: "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "250000",
    fee: "0",
    refunded: "250000",
    refundable: "0",
    status: "refunded",
    closeKind: null,
    createdAt: NOW - 2 * HOUR,
    receivedAt: NOW - 2 * HOUR,
    settleTx: "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc",
    closeTx: null,
    refundTxs: ["0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5"],
    description: "Whitechain checkout",
  },
  {
    // Real: an escrow order the merchant cancelled while it was held; the full amount went back.
    id: "0xd3247aa41d6a23adfe6ae673d6ad2c676da8fdfb188a4c4c5dd8b06ca7bb8e7e",
    kind: "escrow",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "300000",
    fee: "0",
    refunded: "0",
    refundable: "0",
    status: "cancelled",
    closeKind: "cancel",
    createdAt: NOW - 2 * HOUR - 8 * MINUTE,
    receivedAt: null,
    closedAt: NOW - 2 * HOUR - 8 * MINUTE + 13_000,
    settleTx: "0x3e82355da37166f668d4bc1c428d8b03a262915ef2a856ebb10b1423b89e2447",
    closeTx: "0x1e99d1aceab0ddfcebc3f91e6c6650c0c9214f737552382ff68098704cfec5d9",
    refundTxs: [],
    description: "Weather report, Mumbai",
  },
];

/*
 * Escrow v2's review states are not live anywhere yet, so their sample rows load only on the dev
 * server, where the desk is checked. A production build drops this import, and the rows with it.
 */
const devSamples: Order[] = import.meta.env.DEV ? (await import("./review-samples.ts")).reviewSamples() : [];

export const fixtureOrders: Order[] = [...baseOrders, ...devSamples];

/** The refund a fixture desk pretends to send: a hash of its own per order and per attempt, never reused. */
export function fixtureRefundTx(orderId: string, attempt = 0): string {
  const body = orderId.slice(2);
  const cut = (32 + 8 * attempt) % 64 || 4;
  const hash = `0x${body.slice(cut)}${body.slice(0, cut)}`;
  STAND_INS.add(hash.toLowerCase());
  return hash;
}

export const fixtureStatus: RelayStatus = {
  address: "0xa2EEfc657138eE5367291F8e2Ac45BAC28486006",
  balanceWei: "1554000000000000000",
  balanceWbt: "1.554",
  ceiling: {
    capWei: "50000000000000000",
    usedWei: "2200000000000000",
    remainingWei: "47800000000000000",
    txCount: 4,
    maxTx: 200,
    resetsAt: NOW + 41 * MINUTE,
  },
  network: "eip155:1874",
  chainId: 1874,
};

/*
 * Each fixture refund as the relay's /orders/:id reports it. The real refund carries its real block
 * and no time, as today's relay records it; the made-up one carries a time.
 */
const fixtureRefunds: Record<string, RefundRecord[]> = {
  "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc": [
    {
      amount: "250000",
      txHash: "0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5",
      blockNumber: "12361744",
      status: "confirmed",
    },
  ],
  "0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b": [
    {
      amount: "250000",
      txHash: "0x2c4e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c",
      blockNumber: "12362904",
      status: "confirmed",
      at: NOW - 46 * MINUTE,
    },
  ],
};

/** An order as /orders/:id reports it, plus any refunds this visit added on top of the fixtures. */
export function fixtureDetail(order: Order, added: readonly RefundRecord[] = []): ReceiptOrder {
  const refunds = [...(fixtureRefunds[order.id.toLowerCase()] ?? []), ...added];
  // A made-up hash gets no explorer URL here either (STEER-2130 A7): only chain-held ones do.
  const real = (hash: string | null | undefined): hash is string => !!hash && !isStandIn(hash);
  return {
    ...order,
    refunds,
    ...(real(order.settleTx) ? { settleTxUrl: txUrl(order.settleTx) } : {}),
    ...(real(order.closeTx) ? { closeTxUrl: txUrl(order.closeTx) } : {}),
    refundTxUrls: refunds.map((refund) => refund.txHash).filter(real).map((hash) => txUrl(hash)),
  };
}

export function findFixtureOrder(id: string): ReceiptOrder | null {
  const wanted = id.toLowerCase();
  const order = fixtureOrders.find((candidate) => candidate.id.toLowerCase() === wanted);
  return order ? fixtureDetail(order) : null;
}

/** The export a sample desk downloads: the same builder and columns as a live one. */
export function fixtureCsv(): string {
  return ordersCsv(fixtureOrders, { isStandIn });
}
