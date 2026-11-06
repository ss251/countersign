export type OrderKind = "exact" | "escrow";

export type OrderStatus =
  | "pending"
  | "held"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "refund_pending"
  | "cancelled";

/** How an escrow order closed: released to the merchant, cancelled by them, or refunded after the deadline. */
export type CloseKind = "release" | "cancel" | "deadline_refund";

export interface Order {
  id: string;
  kind: OrderKind;
  customer: string;
  merchant: string;
  amount: string;
  /** The escrow toll kept from a released order; "0" for direct payments. */
  fee?: string;
  refunded: string;
  refundable: string;
  status: OrderStatus;
  closeKind?: CloseKind | null;
  createdAt: number;
  /** When the money reached the merchant, in ms; null while held or if it never did. */
  receivedAt?: number | null;
  settleTx: string;
  closeTx?: string | null;
  refundTxs: string[];
  offerHash?: string;
  deadline?: number;
  resource?: string | null;
  description?: string | null;
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
  /** Money that reached the merchant: direct payments, and escrow orders released to them. */
  received: string;
  /** Money still in escrow, not yet the merchant's. */
  held: string;
  /** Money the merchant sent back by transfer. Cancels and deadline refunds were never received. */
  refunded: string;
  /** Escrow tolls kept on released orders. */
  fees: string;
  /** received - fees - refunded, as a magnitude; see netNegative. */
  net: string;
  netNegative: boolean;
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
    case "refund_pending":
      return "Refund settling";
    case "cancelled":
      return "Cancelled";
  }
}

/** Only Paid is green. Held money is blue where it is shown as an amount; its badge stays neutral. */
export function statusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "paid":
      return "settled";
    case "pending":
    case "held":
    case "partially_refunded":
    case "refunded":
    case "refund_pending":
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

/** True when the money of this order reached the merchant. */
export function wasReceived(order: Pick<Order, "kind" | "status" | "closeKind">): boolean {
  if (order.kind === "escrow") return order.closeKind === "release";
  return order.status !== "pending";
}

export function totals(orders: readonly Order[]): Totals {
  let received = 0n;
  let held = 0n;
  let refunded = 0n;
  let fees = 0n;
  for (const order of orders) {
    const amount = parseAtomic(order.amount, "USDT");
    if (order.kind === "escrow" && order.status === "held") held += amount;
    if (!wasReceived(order)) continue;
    received += amount;
    refunded += parseAtomic(order.refunded, "USDT");
    fees += parseAtomic(order.fee ?? "0", "USDT");
  }
  const net = received - fees - refunded;
  return {
    received: received.toString(),
    held: held.toString(),
    refunded: refunded.toString(),
    fees: fees.toString(),
    net: (net < 0n ? -net : net).toString(),
    netNegative: net < 0n,
    count: orders.length,
  };
}

/** What the merchant sold, in words: the payment's description, the hub's offer title, the URL, or the id. */
export function itemLabel(order: Pick<Order, "id" | "description" | "resource">, hubTitle?: string | null): string {
  const text = order.description?.trim() || hubTitle?.trim() || order.resource?.trim();
  return text || `Order ${shortHash(order.id)}`;
}

/** "6 Nov 2026, 14:32 IST": the viewer's own clock, with its zone named. */
export function humanDate(ms: number): string {
  const date = new Date(ms);
  const pick = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  // en-IN names India's zone "IST"; other zones still get their usual short name.
  const zone = pick(new Intl.DateTimeFormat("en-IN", { timeZoneName: "short" }).formatToParts(date), "timeZoneName");
  return zone ? `${day}, ${time} ${zone}` : `${day}, ${time}`;
}

export type RefundReply = { ok: true; txHash: string; refunded?: string } | { ok: false; reason: string };

/**
 * The merchant service answers a refund two ways. A paid order is sent back by transfer:
 * `{ ok, txHash, txUrl, refunded, remaining }`. A held escrow order is cancelled on chain:
 * `{ ok, transaction, url, status: "cancelled" }`. Both are a success.
 */
export function normalizeRefundReply(body: unknown, httpStatus: number): RefundReply | null {
  if (!body || typeof body !== "object" || !("ok" in body)) return null;
  const reply = body as Record<string, unknown>;
  if (reply.ok === false) {
    return { ok: false, reason: typeof reply.reason === "string" ? reply.reason : `http_${httpStatus}` };
  }
  if (reply.ok !== true) return null;
  const txHash = typeof reply.txHash === "string" ? reply.txHash : typeof reply.transaction === "string" ? reply.transaction : null;
  if (!txHash) return null;
  return typeof reply.refunded === "string" ? { ok: true, txHash, refunded: reply.refunded } : { ok: true, txHash };
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

/** The ledger's status filters. Partly refunded money still sits with the merchant, so it is Paid. */
export type OrderFilter = "all" | "paid" | "held" | "refunded";

export const ORDER_FILTERS: ReadonlyArray<{ key: OrderFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "held", label: "Held" },
  { key: "refunded", label: "Refunded" },
];

export function matchesFilter(order: Pick<Order, "status">, filter: OrderFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "paid":
      return order.status === "paid" || order.status === "partially_refunded";
    case "held":
      return order.status === "held" || order.status === "pending";
    case "refunded":
      return order.status === "refunded" || order.status === "refund_pending" || order.status === "cancelled";
  }
}

export function filterCounts(orders: readonly Pick<Order, "status">[]): Record<OrderFilter, number> {
  const counts: Record<OrderFilter, number> = { all: 0, paid: 0, held: 0, refunded: 0 };
  for (const order of orders) {
    for (const { key } of ORDER_FILTERS) if (matchesFilter(order, key)) counts[key] += 1;
  }
  return counts;
}

/** "6 Nov, 14:32": the Received column, where the year is today's. */
export function shortHumanDate(ms: number): string {
  const date = new Date(ms);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${day}, ${time}`;
}

/**
 * When the money reached the merchant. Direct payments arrive at settlement; escrow orders only on
 * release. Held, pending, cancelled and deadline-refunded orders were never received: null.
 */
export function receivedAt(order: Pick<Order, "kind" | "status" | "closeKind" | "createdAt"> & { receivedAt?: number | null }): number | null {
  if (order.receivedAt !== undefined) return order.receivedAt;
  if (!wasReceived(order)) return null;
  // Older relays send no receivedAt; a direct payment settles when it is created.
  return order.kind === "exact" ? order.createdAt : null;
}
