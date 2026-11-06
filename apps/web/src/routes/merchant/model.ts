export type OrderKind = "exact" | "escrow";

export type OrderStatus =
  | "pending"
  | "held"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "refund_pending"
  | "cancelled"
  /** Escrow v2: delivered, with the buyer's review window running. Still held. */
  | "in_review";

/**
 * How an escrow order closed: released to the merchant, cancelled by them, refunded after the
 * deadline, refunded on the buyer's dispute, or refunded because the hub's check failed the delivery.
 */
export type CloseKind = "release" | "cancel" | "deadline_refund" | "dispute_refund" | "delivery_failed";

/** Why money went back. The relay keeps it with the refund; it is optional everywhere. */
export type RefundReason = "requested_by_customer" | "duplicate" | "not_delivered" | "other";

export const REFUND_REASONS: ReadonlyArray<{ value: RefundReason; label: string }> = [
  { value: "requested_by_customer", label: "Requested by customer" },
  { value: "duplicate", label: "Duplicate payment" },
  { value: "not_delivered", label: "Not delivered" },
  { value: "other", label: "Other" },
];

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REFUND_REASONS.find((entry) => entry.value === reason)?.label ?? null;
}

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
  /** The countersigned slip's hash, emitted on chain when the escrow released. */
  slipHash?: string | null;
  /** When an escrow order closed (released, cancelled or refunded), in ms. */
  closedAt?: number | null;
  closeReason?: RefundReason | null;
  /** Hub records name their rail and chain; the Whitechain relay's do not, and mean these defaults. */
  rail?: string;
  network?: string;
  networkName?: string;
  asset?: { symbol: string; decimals: number };
  /** Explorer base for this order's links. */
  explorer?: string;
  /* Escrow v2 review, as the hub serves it (docs/spec/escrow.md, 'Escrow v2'). Times in ms. */
  reviewWindow?: number | null;
  deliveredAt?: number | null;
  reviewEndsAt?: number | null;
  acceptedAt?: number | null;
  acceptTx?: string | null;
  disputedAt?: number | null;
  disputeTx?: string | null;
  releasedAfterWindow?: boolean;
  /** The seller's bond paid to the buyer when the hub's check failed the delivery; "0" when none. */
  bondSlashed?: string;
}

export interface RefundRecord {
  amount?: string;
  txHash: string;
  blockNumber?: string;
  nonce?: string;
  status?: "pending" | "confirmed";
  reason?: string | null;
  /** When the refund was sent, in ms; older relays do not record it. */
  at?: number | null;
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
    case "in_review":
      return "In review";
  }
}

/**
 * The colour of a status dot. Green is settled: the merchant was paid. Blue is money still in
 * flight: held in escrow, or a transfer that has not landed. Returned money settles nothing, so
 * refunded and cancelled are ink.
 */
export function statusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "paid":
      return "settled";
    case "pending":
    case "held":
    case "in_review":
    case "refund_pending":
      return "money";
    case "partially_refunded":
    case "refunded":
    case "cancelled":
      return "neutral";
  }
}

/** Money still in the escrow that may yet be cancelled: held, or delivered and in review. */
export function isEscrowOpen(status: OrderStatus): boolean {
  return status === "held" || status === "in_review";
}

export function canRefund(order: Pick<Order, "status" | "refundable">): boolean {
  if (
    order.status !== "held" &&
    order.status !== "in_review" &&
    order.status !== "paid" &&
    order.status !== "partially_refunded"
  ) {
    return false;
  }
  return parseAtomic(order.refundable, "USDT") > 0n;
}

export function refundLabel(order: Pick<Order, "status" | "refundable">): string {
  const amount = formatUsdt(order.refundable);
  return isEscrowOpen(order.status) ? `Cancel and refund ${amount}` : `Refund ${amount}`;
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
    if (order.kind === "escrow" && isEscrowOpen(order.status)) held += amount;
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

/**
 * What the merchant sold, in words: the payment's description, the hub's offer title, a label made
 * from the paid URL's last path segment, or the id. Never a raw URL: a host such as 127.0.0.1 means
 * nothing to the merchant and leaks the setup.
 */
export function itemLabel(order: Pick<Order, "id" | "description" | "resource">, hubTitle?: string | null): string {
  const text = order.description?.trim() || hubTitle?.trim();
  return text || pathLabel(order.resource) || `Order ${shortHash(order.id)}`;
}

/** "http://127.0.0.1:8404/forecast" -> "Forecast"; "https://shop.example/whitechain/check-out" -> "Check out". */
export function pathLabel(resource: string | null | undefined): string | null {
  const raw = resource?.trim();
  if (!raw) return null;
  let path = raw;
  try {
    path = new URL(raw).pathname;
  } catch {
    // Not a URL: read it as a path.
  }
  const last = path.split(/[/?#]/).filter(Boolean).pop();
  if (!last || /^\d+$/.test(last) || /^0x[0-9a-f]+$/i.test(last)) return null;
  let words = last;
  try {
    words = decodeURIComponent(last);
  } catch {
    // Keep the segment as written.
  }
  words = words.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[-_+.]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
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

export type RefundReply =
  | { ok: true; txHash: string; refunded?: string }
  | { ok: false; reason: string }
  /** Sent, but not confirmed: it may have gone through, so it is never shown as refused or offered again. */
  | { ok: "unknown"; reason: string };

/**
 * The merchant service answers a refund two ways. A paid order is sent back by transfer:
 * `{ ok, txHash, txUrl, refunded, remaining }`. A held escrow order is cancelled on chain:
 * `{ ok, transaction, url, status: "cancelled" }`. Both are a success.
 */
export function normalizeRefundReply(body: unknown, httpStatus: number): RefundReply | null {
  if (!body || typeof body !== "object" || !("ok" in body)) return null;
  const reply = body as Record<string, unknown>;
  if (reply.ok === false) {
    const reason = typeof reply.reason === "string" ? reply.reason : `http_${httpStatus}`;
    // The relayer sent it and is still waiting for the chain: pending, not refused.
    if (reason === "settlement_pending") {
      return { ok: "unknown", reason: "The refund was sent and is still settling on chain." };
    }
    return { ok: false, reason };
  }
  if (reply.ok !== true) return null;
  const txHash = typeof reply.txHash === "string" ? reply.txHash : typeof reply.transaction === "string" ? reply.transaction : null;
  if (!txHash) return null;
  return typeof reply.refunded === "string" ? { ok: true, txHash, refunded: reply.refunded } : { ok: true, txHash };
}

export function txUrl(hash: string, explorer: string = EXPLORER): string {
  return `${explorer}/tx/${hash}`;
}

export function addressUrl(address: string, explorer: string = EXPLORER): string {
  return `${explorer}/address/${address}`;
}

/* An order without these fields is a Whitechain relay record. */
export function assetOf(order: Pick<Order, "asset">): string {
  return order.asset?.symbol || "USDT";
}

export function networkNameOf(order: Pick<Order, "networkName" | "network">): string {
  if (order.networkName) return order.networkName;
  return !order.network || order.network === "eip155:1874" ? "Whitechain Sepolia" : order.network;
}

export function explorerOf(order: Pick<Order, "explorer">): string {
  return order.explorer?.replace(/\/+$/, "") || EXPLORER;
}

export function isWhitechain(order: Pick<Order, "network">): boolean {
  return !order.network || order.network === "eip155:1874";
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
      return order.status === "held" || order.status === "in_review" || order.status === "pending";
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

/** Time left in a review window: "4:32", or "1:02:05" past an hour; "0:00" once it has ended. */
export function countdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

/** 300 -> "5-minute"; 7200 -> "2-hour": how long a buyer has to review. */
export function windowWords(seconds: number): string {
  if (seconds < 120) return `${seconds}-second`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}-minute`;
  return `${Math.round(seconds / 3600)}-hour`;
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

/* ------------------------------------------------------------ the desk's arithmetic */

/**
 * The header: released − refunded − toll = net. Held escrow is not the merchant's until it
 * releases, so it stands beside the sum as pending and never enters it. Atomic USDT.
 */
export interface Equation {
  released: bigint;
  refunded: bigint;
  toll: bigint;
  /** Seller bonds paid to buyers when the hub's check failed a delivery. */
  bondLost: bigint;
  net: bigint;
  /** In escrow, releasing on delivery: shown, never counted. */
  held: bigint;
}

export function equation(orders: readonly Order[]): Equation {
  const sums = totals(orders);
  const released = BigInt(sums.received);
  const refunded = BigInt(sums.refunded);
  const toll = BigInt(sums.fees);
  const bondLost = orders.reduce((sum, order) => sum + parseAtomic(order.bondSlashed ?? "0", "USDT"), 0n);
  return {
    released,
    refunded,
    toll,
    bondLost,
    net: released - refunded - toll - bondLost,
    held: BigInt(sums.held),
  };
}

/** True while an order's money is still in flight: held in escrow, or a payment settling. */
export function isPending(order: Pick<Order, "kind" | "status">): boolean {
  return order.status === "pending" || (order.kind === "escrow" && isEscrowOpen(order.status));
}

/**
 * What one order adds to the balance: money that reached the merchant, less toll and refunds, and
 * less a bond the hub's check sent to the buyer.
 */
export function contribution(order: Order): bigint {
  const lost = parseAtomic(order.bondSlashed ?? "0", "USDT");
  if (!wasReceived(order)) return -lost;
  return (
    parseAtomic(order.amount, "USDT") -
    parseAtomic(order.fee ?? "0", "USDT") -
    parseAtomic(order.refunded, "USDT") -
    lost
  );
}

export interface LedgerRow {
  order: Order;
  /** The running balance once this order is counted, oldest first. */
  balance: bigint;
  /** Held or settling: the row shows "Pending" in place of a balance, and adds nothing to it. */
  pending: boolean;
}

/** Every order with its running balance, newest first. The newest counted balance is the header's Net. */
export function ledger(orders: readonly Order[]): LedgerRow[] {
  const oldestFirst = [...orders].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let balance = 0n;
  const rows = oldestFirst.map((order) => {
    balance += contribution(order);
    return { order, balance, pending: isPending(order) };
  });
  return rows.reverse();
}

/** The lines under an amount that explain why the balance moved by less than it. */
export type ReturnKind = "cancel" | "deadline_refund" | "dispute_refund" | "delivery_failed";

export type Adjustment =
  | { kind: "toll"; amount: bigint }
  | { kind: "refunded"; amount: bigint }
  | { kind: "returned"; amount: bigint; close: ReturnKind }
  | { kind: "bond"; amount: bigint }
  | { kind: "review"; endsAt: number | null }
  | { kind: "held" }
  | { kind: "settling" };

export function adjustments(order: Order): Adjustment[] {
  if (order.status === "pending") return [{ kind: "settling" }];
  if (order.kind === "escrow" && order.status === "in_review") {
    return [{ kind: "review", endsAt: order.reviewEndsAt ?? null }];
  }
  if (order.kind === "escrow" && order.status === "held") return [{ kind: "held" }];
  const close = order.closeKind;
  if (close === "cancel" || close === "deadline_refund" || close === "dispute_refund" || close === "delivery_failed") {
    const lines: Adjustment[] = [{ kind: "returned", amount: parseAtomic(order.amount, "USDT"), close }];
    const lost = parseAtomic(order.bondSlashed ?? "0", "USDT");
    if (lost > 0n) lines.push({ kind: "bond", amount: lost });
    return lines;
  }
  const lines: Adjustment[] = [];
  const fee = parseAtomic(order.fee ?? "0", "USDT");
  const refunded = parseAtomic(order.refunded, "USDT");
  if (fee > 0n) lines.push({ kind: "toll", amount: fee });
  if (refunded > 0n) lines.push({ kind: "refunded", amount: refunded });
  return lines;
}

function fractionDigits(atomic: bigint): number {
  const magnitude = atomic < 0n ? -atomic : atomic;
  return (magnitude % USDT_SCALE).toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "").length;
}

/** The fewest decimals, at least `min`, that show every value exactly, so a column lines up. */
export function decimalsFor(values: readonly bigint[], min = 2): number {
  return values.reduce((most, value) => Math.max(most, fractionDigits(value)), min);
}

/**
 * Atomic USDT at a fixed number of decimals, with a true minus sign. Never rounds: a value that
 * needs more places than asked gets them, so no digit of money is ever hidden.
 */
export function formatFixed(atomic: bigint, decimals: number): string {
  const places = Math.min(Math.max(decimals, fractionDigits(atomic)), USDT_DECIMALS);
  const negative = atomic < 0n;
  const magnitude = negative ? -atomic : atomic;
  const whole = magnitude / USDT_SCALE;
  const fraction = (magnitude % USDT_SCALE).toString().padStart(USDT_DECIMALS, "0").slice(0, places);
  return `${negative ? "−" : ""}${whole}${places > 0 ? `.${fraction}` : ""}`;
}

export type AmountCheck = { ok: true; atomic: bigint } | { ok: false; message: string };

/** A refund amount typed by the merchant: a plain decimal, more than zero, never more than what is left. */
export function checkRefundAmount(input: string, remainder: bigint): AmountCheck {
  const text = input.trim();
  if (text === "") return { ok: false, message: "Enter an amount." };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || ((match[1] ?? "") === "" && (match[2] ?? "") === "")) {
    return { ok: false, message: "Enter an amount like 0.25." };
  }
  const fraction = match[2] ?? "";
  if (fraction.length > USDT_DECIMALS) return { ok: false, message: "USDT has six decimals at most." };
  const atomic = BigInt(match[1] || "0") * USDT_SCALE + BigInt(fraction.padEnd(USDT_DECIMALS, "0"));
  if (atomic <= 0n) return { ok: false, message: "Enter more than 0." };
  if (atomic > remainder) {
    return { ok: false, message: `Only ${formatUsdt(remainder.toString())} USDT is left to refund.` };
  }
  return { ok: true, atomic };
}

/** "merchant_balance_low" -> "Merchant balance low" */
export function refusalWords(reason: string): string {
  const cleaned = reason
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\.+$/, "");
  if (cleaned === "") return "The refund did not go through";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatBlock(block: string): string {
  return /^\d+$/.test(block) ? Number(block).toLocaleString("en-GB") : block;
}

/* ------------------------------------------------------------------- the timeline */

export type EventTone = "money" | "settled" | "neutral" | "refused";

export interface TimelineEvent {
  key: string;
  tone: EventTone;
  /** What happened, in words. */
  title: string;
  /** A second line: the reason, the toll, the deadline. */
  detail?: string | null;
  at?: number | null;
  block?: string | null;
  txHash?: string | null;
  slipHash?: string | null;
}

/** A refund the chain or the relay refused during this visit. Nothing records these server side. */
export interface Refusal {
  at: number;
  reason: string;
}

/**
 * What happened to an order, newest first, each step with its proof. `who` sets the voice: the
 * merchant reads "Released to you", the customer reads "Released to the merchant".
 */
export function timeline(
  order: ReceiptOrder,
  who: "merchant" | "customer",
  refusals: readonly Refusal[] = [],
): TimelineEvent[] {
  const amount = formatUsdt(order.amount);
  const unit = assetOf(order);
  const events: TimelineEvent[] = [];

  if (order.kind === "escrow") {
    const deadline = order.deadline ? shortHumanDate(order.deadline) : null;
    const back = who === "merchant" ? "the customer" : "you";
    const window = order.reviewWindow && order.reviewWindow > 0 ? order.reviewWindow : null;
    const releases = window
      ? `Releases after delivery and a ${windowWords(window)} review.`
      : "Releases on delivery.";
    events.push({
      key: "fund",
      tone: "money",
      title: order.status === "pending" ? `Funding escrow with ${amount} ${unit}` : `${amount} ${unit} held in escrow`,
      detail: deadline ? `${releases} Returns to ${back} if not delivered by ${deadline}.` : releases,
      at: order.createdAt,
      txHash: order.settleTx,
    });
  } else {
    events.push({
      key: "pay",
      tone: order.status === "pending" ? "money" : "settled",
      title: `${who === "merchant" ? "Received" : "Paid"} ${amount} ${unit}`,
      detail: order.status === "pending" ? `Settling on ${networkNameOf(order)}.` : null,
      at: order.createdAt,
      txHash: order.settleTx,
    });
  }

  // Escrow v2: delivery commits the slip and opens the buyer's review window.
  const delivered = order.kind === "escrow" && (order.deliveredAt != null || order.status === "in_review");
  if (delivered) {
    const ends = order.reviewEndsAt ? shortHumanDate(order.reviewEndsAt) : null;
    events.push({
      key: "delivered",
      tone: "money",
      title: "Delivered. In review",
      detail: ends
        ? who === "merchant"
          ? `The customer can dispute until ${ends}.`
          : `Your agent can accept it now, or dispute it until ${ends}.`
        : null,
      at: order.deliveredAt ?? null,
      slipHash: order.slipHash ?? null,
    });
  }

  const closedAt = order.closedAt ?? null;
  if (order.closeKind === "release") {
    const fee = parseAtomic(order.fee ?? "0", "USDT");
    const accepted = order.acceptedAt != null || order.acceptTx != null;
    if (accepted) {
      events.push({
        key: "accepted",
        tone: "settled",
        title: who === "merchant" ? "Accepted by the customer" : "You accepted the delivery",
        at: order.acceptedAt ?? null,
        txHash: order.acceptTx ?? null,
      });
    }
    const afterWindow = order.releasedAfterWindow === true;
    events.push({
      key: "release",
      tone: "settled",
      title: afterWindow
        ? who === "merchant"
          ? "Released to you after the review window"
          : "Released to the merchant after the review window"
        : who === "merchant"
          ? "Released to you"
          : "Released to the merchant",
      detail:
        [afterWindow ? "Nobody disputed in time." : null, fee > 0n ? `Toll ${formatUsdt(fee.toString())} ${unit}.` : null]
          .filter(Boolean)
          .join(" ") || null,
      at: order.receivedAt ?? closedAt,
      // Accepting releases in the same transaction: link it once, on the acceptance.
      txHash: accepted && order.acceptTx && order.acceptTx === order.closeTx ? null : (order.closeTx ?? null),
      slipHash: delivered ? null : (order.slipHash ?? null),
    });
  } else if (order.closeKind === "cancel") {
    events.push({
      key: "cancel",
      tone: "neutral",
      title:
        who === "merchant"
          ? `Cancelled. ${amount} ${unit} returned to the customer`
          : `Cancelled by the merchant. ${amount} ${unit} returned to you`,
      detail: reasonLabel(order.closeReason),
      at: closedAt,
      txHash: order.closeTx ?? null,
    });
  } else if (order.closeKind === "deadline_refund") {
    events.push({
      key: "deadline",
      tone: "neutral",
      title: `Not delivered in time. ${amount} ${unit} returned${who === "merchant" ? " to the customer" : " to you"}`,
      at: closedAt,
      txHash: order.closeTx ?? null,
    });
  } else if (order.closeKind === "dispute_refund") {
    events.push({
      key: "dispute",
      tone: "refused",
      title:
        who === "merchant"
          ? `Disputed by the customer. ${amount} ${unit} returned to them`
          : `You disputed the delivery. ${amount} ${unit} returned to you`,
      at: order.disputedAt ?? closedAt,
      txHash: order.disputeTx ?? order.closeTx ?? null,
    });
  } else if (order.closeKind === "delivery_failed") {
    const lost = parseAtomic(order.bondSlashed ?? "0", "USDT");
    const bond = lost > 0n ? `${formatUsdt(lost.toString())} ${unit}` : null;
    events.push({
      key: "failed",
      tone: "refused",
      title:
        who === "merchant"
          ? `The hub's check failed the delivery. ${amount} ${unit} returned to the customer`
          : `The delivery failed the hub's check. ${amount} ${unit} returned to you`,
      detail: bond
        ? who === "merchant"
          ? `Your bond of ${bond} went to the customer.`
          : `The seller's bond of ${bond} was paid to you.`
        : null,
      at: closedAt,
      txHash: order.closeTx ?? null,
    });
  }

  const records: RefundRecord[] = order.refunds?.length
    ? order.refunds
    : order.refundTxs.map((txHash) => ({ txHash }));
  records.forEach((refund, index) => {
    const value = refund.amount ?? (records.length === 1 ? order.refunded : undefined);
    const shown = value && value !== "0" ? `${formatUsdt(value)} ${unit}` : null;
    const pending = refund.status === "pending";
    events.push({
      key: `refund-${refund.txHash}-${index}`,
      tone: pending ? "money" : "neutral",
      title: pending ? `Refund${shown ? ` of ${shown}` : ""} settling` : `Refunded${shown ? ` ${shown}` : ""}`,
      detail: reasonLabel(refund.reason),
      at: refund.at ?? null,
      block: refund.blockNumber ?? null,
      txHash: refund.txHash,
    });
  });

  // Steps the relay did not time inherit the time of the step before them, so the order holds.
  let last = 0;
  const timed = events.map((event) => {
    last = event.at ?? last;
    return { event, when: last };
  });
  refusals.forEach((refusal, index) => {
    timed.push({
      event: {
        key: `refused-${refusal.at}-${index}`,
        tone: "refused",
        title: `Refund refused. ${refusalWords(refusal.reason)}`,
        at: refusal.at,
      },
      when: refusal.at,
    });
  });
  timed.sort((a, b) => a.when - b.when);
  return timed.map((entry) => entry.event).reverse();
}

/* ------------------------------------------------------------- hub records */

const STATUSES: readonly OrderStatus[] = [
  "pending",
  "held",
  "paid",
  "partially_refunded",
  "refunded",
  "refund_pending",
  "cancelled",
  "in_review",
];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function atomic(value: unknown, fallback = "0"): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return fallback;
}

/**
 * A time in ms. The escrow keeps its deadline in seconds, as the chain does, and the relay passes it
 * on as it is; a value too small to be ms after 2001 is read as seconds.
 */
function millis(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 1e12 ? value * 1000 : value;
}

function statusOf(value: unknown): OrderStatus | null {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
  if (raw === "released" || raw === "settled") return "paid";
  // /jobs names the review state after the contract ("delivered"); /orders calls it in_review.
  if (raw === "delivered" || raw === "in_review") return "in_review";
  if (raw === "partly_refunded") return "partially_refunded";
  return (STATUSES as readonly string[]).includes(raw) ? (raw as OrderStatus) : null;
}

/**
 * One record from the hub's /orders (wc/orders-contract.md), or the Whitechain relay's, as the
 * desk's Order. Anything that cannot be a real order (no id, no amount, no known status) is
 * dropped rather than guessed at.
 */
export function fromHubOrder(raw: unknown): Order | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id) ?? text(r.jobId);
  const status = statusOf(r.status);
  const amount = atomic(r.amount, "");
  if (!id || !status || amount === "") return null;
  const closeKind =
    r.closeKind === "release" ||
    r.closeKind === "cancel" ||
    r.closeKind === "deadline_refund" ||
    r.closeKind === "dispute_refund" ||
    r.closeKind === "delivery_failed"
      ? r.closeKind
      : null;
  const asset =
    r.asset && typeof r.asset === "object" && text((r.asset as Record<string, unknown>).symbol)
      ? {
          symbol: text((r.asset as Record<string, unknown>).symbol)!,
          decimals: Number((r.asset as Record<string, unknown>).decimals ?? 6),
        }
      : undefined;
  const refunded = atomic(r.refunded);
  return {
    id,
    kind: r.kind === "exact" ? "exact" : "escrow",
    customer: text(r.customer) ?? text(r.buyer) ?? "",
    merchant: text(r.merchant) ?? text(r.seller) ?? "",
    amount,
    fee: atomic(r.fee),
    refunded,
    refundable: atomic(r.refundable, status === "held" || status === "in_review" || status === "paid" ? amount : "0"),
    status,
    closeKind: closeKind ?? (status === "paid" && r.kind !== "exact" ? "release" : null),
    createdAt: millis(r.createdAt) ?? 0,
    receivedAt: millis(r.receivedAt),
    closedAt: millis(r.closedAt),
    settleTx: text(r.settleTx) ?? "",
    closeTx: text(r.closeTx),
    refundTxs: Array.isArray(r.refundTxs) ? r.refundTxs.filter((tx): tx is string => typeof tx === "string") : [],
    slipHash: text(r.slipHash),
    offerHash: text(r.offerHash) ?? undefined,
    deadline: millis(r.deadline) ?? undefined,
    description: text(r.description) ?? text(r.offerTitle),
    resource: text(r.resource),
    rail: text(r.rail) ?? undefined,
    network: text(r.network) ?? undefined,
    networkName: text(r.networkName) ?? undefined,
    asset,
    explorer: text(r.explorer) ?? undefined,
    reviewWindow: typeof r.reviewWindow === "number" && Number.isFinite(r.reviewWindow) ? r.reviewWindow : null,
    deliveredAt: millis(r.deliveredAt),
    reviewEndsAt: millis(r.reviewEndsAt),
    acceptedAt: millis(r.acceptedAt),
    acceptTx: text(r.acceptTx),
    disputedAt: millis(r.disputedAt),
    disputeTx: text(r.disputeTx),
    releasedAfterWindow: r.releasedAfterWindow === true,
    bondSlashed: atomic(r.bondSlashed),
  };
}

/** A single record from /orders/:id, with every refund it reports. */
export function fromHubRecord(raw: unknown): ReceiptOrder | null {
  const order = fromHubOrder(raw);
  if (!order) return null;
  const list = (raw as { refunds?: unknown }).refunds;
  const refunds: RefundRecord[] = Array.isArray(list)
    ? list.flatMap((entry): RefundRecord[] => {
        if (!entry || typeof entry !== "object") return [];
        const e = entry as Record<string, unknown>;
        const txHash = text(e.txHash);
        if (!txHash) return [];
        return [
          {
            txHash,
            amount: atomic(e.amount, "") || undefined,
            blockNumber: atomic(e.blockNumber, "") || undefined,
            status: e.status === "pending" ? "pending" : "confirmed",
            reason: text(e.reason),
            at: millis(e.at),
          },
        ];
      })
    : [];
  return { ...order, refunds };
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const ORDERS_CSV_HEADER =
  "date_utc,order_id,kind,customer,merchant,amount_usdt,fee_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls";

/** The accountant's export: the relay's orders.csv columns, built from whatever the desk is showing. */
export function ordersCsv(orders: readonly Order[]): string {
  const rows = [ORDERS_CSV_HEADER];
  for (const order of orders) {
    const net = contribution(order);
    const explorer = explorerOf(order);
    rows.push(
      [
        new Date(order.createdAt).toISOString(),
        order.id,
        order.kind,
        order.customer,
        order.merchant,
        formatUsdt(order.amount),
        formatUsdt(order.fee ?? "0"),
        formatUsdt(order.refunded),
        `${net < 0n ? "-" : ""}${formatUsdt((net < 0n ? -net : net).toString())}`,
        order.status,
        order.settleTx ? txUrl(order.settleTx, explorer) : "",
        order.closeTx ? txUrl(order.closeTx, explorer) : "",
        order.refundTxs.map((hash) => txUrl(hash, explorer)).join(" "),
      ]
        .map(csvField)
        .join(","),
    );
  }
  return `${rows.join("\n")}\n`;
}
