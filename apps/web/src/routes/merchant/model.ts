export type OrderKind = "exact" | "escrow";

export type OrderStatus =
  | "pending"
  | "held"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "cancelled";

export interface Order {
  id: string;
  kind: OrderKind;
  customer: string;
  merchant: string;
  amount: string;
  refunded: string;
  refundable: string;
  status: OrderStatus;
  createdAt: number;
  settleTx: string;
  closeTx?: string | null;
  refundTxs: string[];
  offerHash?: string;
  deadline?: number;
  resource?: string | null;
}

export interface RefundRecord {
  amount?: string;
  txHash: string;
  blockNumber?: string;
  nonce?: string;
}

export interface ReceiptOrder extends Order {
  refunds?: RefundRecord[];
  settleTxUrl?: string;
  closeTxUrl?: string;
  refundTxUrls?: string[];
}

export interface RelayCeiling {
  capWei: string;
  usedWei: string;
  remainingWei: string;
  txCount: number;
  maxTx: number;
  resetsAt: number | string;
}

export interface RelayStatus {
  address: string;
  balanceWei: string;
  balanceWbt: string;
  ceiling: RelayCeiling;
  network: string;
  chainId: number;
}

export type StatusTone = "money" | "settled" | "neutral";

export interface Totals {
  received: string;
  refunded: string;
  net: string;
  count: number;
}

const USDT_DECIMALS = 6;
const USDT_SCALE = 10n ** BigInt(USDT_DECIMALS);
const WBT_DECIMALS = 18;
const WBT_SCALE = 10n ** BigInt(WBT_DECIMALS);
const WBT_STEP = 10n ** BigInt(WBT_DECIMALS - 4);

const EXPLORER = "https://explorer.testnet.whitechain.io";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function parseAtomic(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`Not an atomic ${label} amount: ${value}`);
  return BigInt(value);
}

/** Atomic USDT (six decimals) to a display amount with two to six decimals. */
export function formatUsdt(atomic: string): string {
  const value = parseAtomic(atomic, "USDT");
  const whole = value / USDT_SCALE;
  const fraction = (value % USDT_SCALE).toString().padStart(USDT_DECIMALS, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.length < 2 ? trimmed.padEnd(2, "0") : trimmed}`;
}

function shorten(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function shortAddress(address: string): string {
  return shorten(address);
}

export function shortHash(hash: string): string {
  return shorten(hash);
}

export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Settling";
    case "held":
      return "Held in escrow";
    case "paid":
      return "Paid";
    case "partially_refunded":
      return "Partly refunded";
    case "refunded":
      return "Refunded";
    case "cancelled":
      return "Cancelled";
  }
}

export function statusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "pending":
    case "held":
      return "money";
    case "paid":
      return "settled";
    case "partially_refunded":
    case "refunded":
    case "cancelled":
      return "neutral";
  }
}

export function canRefund(order: Pick<Order, "status" | "refundable">): boolean {
  if (order.status !== "held" && order.status !== "paid" && order.status !== "partially_refunded") {
    return false;
  }
  return parseAtomic(order.refundable, "USDT") > 0n;
}

export function refundLabel(order: Pick<Order, "status" | "refundable">): string {
  const amount = formatUsdt(order.refundable);
  return order.status === "held" ? `Cancel and refund ${amount}` : `Refund ${amount}`;
}

export function totals(orders: readonly Order[]): Totals {
  let received = 0n;
  let refunded = 0n;
  for (const order of orders) {
    if (order.status === "pending" || order.status === "cancelled") continue;
    received += parseAtomic(order.amount, "USDT");
    refunded += parseAtomic(order.refunded, "USDT");
  }
  return {
    received: received.toString(),
    refunded: refunded.toString(),
    net: (received > refunded ? received - refunded : 0n).toString(),
    count: orders.length,
  };
}

export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`;
}

function shortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""} ${date.getFullYear()}`;
}

export function relativeTime(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return shortDate(ms);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** ISO-shaped local time, without a zone suffix. */
export function localIso(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** yyyy-mm-dd in local time, for file names. */
export function dateStamp(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function decimalToWei(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{0,18}))?$/.exec(value.trim());
  if (!match) throw new Error(`Not a WBT amount: ${value}`);
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(WBT_DECIMALS, "0");
  return BigInt(whole) * WBT_SCALE + BigInt(fraction === "" ? "0" : fraction);
}

/** Wei to WBT with exactly four decimals, rounded half up using integer maths. */
export function formatWeiWbt(wei: string): string {
  if (!/^\d+$/.test(wei)) throw new Error(`Not a wei amount: ${wei}`);
  const rounded = (BigInt(wei) + WBT_STEP / 2n) / WBT_STEP;
  const whole = rounded / 10_000n;
  const fraction = (rounded % 10_000n).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}

/** A decimal WBT amount (as the relay reports it) to exactly four decimals. */
export function formatWbt(value: string): string {
  return formatWeiWbt(decimalToWei(value).toString());
}
