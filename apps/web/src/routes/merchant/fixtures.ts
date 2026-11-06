import type { Order, ReceiptOrder, RelayStatus } from "./model.ts";
import { formatUsdt, txUrl } from "./model.ts";

const MERCHANT = "0xd5882dBC7D41fBcf8ae0B05E9eAc1cbe93d6C71c";
const CUSTOMER = "0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298";

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const fixtureMerchant = MERCHANT;

export const fixtureOrders: Order[] = [
  {
    id: "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "250000",
    refunded: "0",
    refundable: "250000",
    status: "paid",
    createdAt: NOW - 42_000,
    settleTx: "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc",
    closeTx: null,
    refundTxs: [],
    resource: "Nightly build minutes",
  },
  {
    id: "0xed46569a929aca0d1c3c3a948851a355b0ba3ccb6db14db764edb75b024336a0",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "1500000",
    refunded: "0",
    refundable: "1500000",
    status: "paid",
    createdAt: NOW - 6 * MINUTE,
    settleTx: "0xed46569a929aca0d1c3c3a948851a355b0ba3ccb6db14db764edb75b024336a0",
    closeTx: null,
    refundTxs: [],
    resource: "Signed release, v2.4.1",
  },
  {
    id: "0x25a2849a744daf946318298316a57d51abb3fb3fe94deb8b810ce3a2899b9643",
    kind: "escrow",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "400000",
    refunded: "0",
    refundable: "400000",
    status: "held",
    createdAt: NOW - 18 * MINUTE,
    settleTx: "0x960e5efa466992c759d713fcff24aec89d796fb7df48d90fa7d0c8f49ee479b6",
    closeTx: null,
    refundTxs: [],
    offerHash: "0x5f2ec1bdd93c80f435a86dc2582c2e94b5e5eb3876acefe374deeff8d5398c68",
    deadline: NOW + 25 * MINUTE,
    resource: "Custom settlement review",
  },
  {
    id: "0x2a972f96fd6616c5a0dded46f86023a7d98f970d4ff536f47e7938e5855544a7",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "1000000",
    refunded: "250000",
    refundable: "750000",
    status: "partially_refunded",
    createdAt: NOW - 52 * MINUTE,
    settleTx: "0x2a972f96fd6616c5a0dded46f86023a7d98f970d4ff536f47e7938e5855544a7",
    closeTx: null,
    refundTxs: ["0xf75433250969b1356781fc4079a939fc25324feab2c4c4dcf222a0a0c2cb929c"],
    resource: "Licence renewal",
  },
  {
    id: "0x0c52215ccab88f1fcdc27e68211528ea9eaa26db1d1e2d6ab81434be1cde5dd6",
    kind: "exact",
    customer: CUSTOMER,
    merchant: MERCHANT,
    amount: "250000",
    refunded: "250000",
    refundable: "0",
    status: "refunded",
    createdAt: NOW - 3 * HOUR,
    settleTx: "0x0c52215ccab88f1fcdc27e68211528ea9eaa26db1d1e2d6ab81434be1cde5dd6",
    closeTx: null,
    refundTxs: ["0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5"],
    resource: "Build minutes, cancelled",
  },
];

export const fixtureStatus: RelayStatus = {
  address: "0xa2EEfc657138eE5367291F8e2Ac45BAC28486006",
  balanceWei: "1420000000000000000",
  balanceWbt: "1.42",
  ceiling: {
    capWei: "50000000000000000",
    usedWei: "11340000000000000",
    remainingWei: "38660000000000000",
    txCount: 34,
    maxTx: 200,
    resetsAt: NOW + 41 * MINUTE,
  },
  network: "eip155:1874",
  chainId: 1874,
};

export function findFixtureOrder(id: string): ReceiptOrder | null {
  const wanted = id.toLowerCase();
  const order = fixtureOrders.find((candidate) => candidate.id.toLowerCase() === wanted);
  if (!order) return null;
  return {
    ...order,
    refunds: order.refundTxs.map((txHash, index) => ({
      amount: index === 0 ? order.refunded : undefined,
      txHash,
    })),
    settleTxUrl: txUrl(order.settleTx),
    refundTxUrls: order.refundTxs.map((txHash) => txUrl(txHash)),
  };
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER =
  "date_utc,payment_id,payer,merchant,amount_usdt,refunded_usdt,net_usdt,status,settle_tx_url,refund_tx_urls";

export function fixtureCsv(): string {
  const rows = [CSV_HEADER];
  for (const order of fixtureOrders) {
    const amount = BigInt(order.amount);
    const refunded = BigInt(order.refunded);
    rows.push(
      [
        new Date(order.createdAt).toISOString(),
        order.id,
        order.customer,
        order.merchant,
        formatUsdt(order.amount),
        formatUsdt(order.refunded),
        formatUsdt((amount > refunded ? amount - refunded : 0n).toString()),
        order.status,
        txUrl(order.settleTx),
        order.refundTxs.map((hash) => txUrl(hash)).join(" "),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}
