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
    case "refund_pending":
      return "money";
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

/* ------------------------------------------------------------ the desk's arithmetic */

/** The header: released + held = total, then total − refunded − toll = net. Atomic USDT. */
export interface Equation {
  released: bigint;
  held: bigint;
  total: bigint;
  refunded: bigint;
  toll: bigint;
  net: bigint;
}

export function equation(orders: readonly Order[]): Equation {
  const sums = totals(orders);
  const released = BigInt(sums.received);
  const held = BigInt(sums.held);
  const refunded = BigInt(sums.refunded);
  const toll = BigInt(sums.fees);
  const total = released + held;
  return { released, held, total, refunded, toll, net: total - refunded - toll };
}

/** What one order adds to the balance. Held money counts, exactly as it does in the header's Net. */
export function contribution(order: Order): bigint {
  const amount = parseAtomic(order.amount, "USDT");
  if (order.kind === "escrow" && order.status === "held") return amount;
  if (!wasReceived(order)) return 0n;
  return amount - parseAtomic(order.fee ?? "0", "USDT") - parseAtomic(order.refunded, "USDT");
}

export interface LedgerRow {
  order: Order;
  /** The running balance once this order is counted, oldest first. */
  balance: bigint;
}

/** Every order with its running balance, newest first. The top row's balance is the header's Net. */
export function ledger(orders: readonly Order[]): LedgerRow[] {
  const oldestFirst = [...orders].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let balance = 0n;
  const rows = oldestFirst.map((order) => {
    balance += contribution(order);
    return { order, balance };
  });
  return rows.reverse();
}

/** The lines under an amount that explain why the balance moved by less than it. */
export type Adjustment =
  | { kind: "toll"; amount: bigint }
  | { kind: "refunded"; amount: bigint }
  | { kind: "returned"; amount: bigint; close: "cancel" | "deadline_refund" }
  | { kind: "held" }
  | { kind: "settling" };

export function adjustments(order: Order): Adjustment[] {
  if (order.status === "pending") return [{ kind: "settling" }];
  if (order.kind === "escrow" && order.status === "held") return [{ kind: "held" }];
  if (order.closeKind === "cancel" || order.closeKind === "deadline_refund") {
    return [{ kind: "returned", amount: parseAtomic(order.amount, "USDT"), close: order.closeKind }];
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
  const events: TimelineEvent[] = [];

  if (order.kind === "escrow") {
    const deadline = order.deadline ? shortHumanDate(order.deadline) : null;
    const back = who === "merchant" ? "the customer" : "you";
    events.push({
      key: "fund",
      tone: "money",
      title: order.status === "pending" ? `Funding escrow with ${amount} USDT` : `${amount} USDT held in escrow`,
      detail: deadline
        ? `Releases on delivery. Returns to ${back} if not delivered by ${deadline}.`
        : "Releases on delivery.",
      at: order.createdAt,
      txHash: order.settleTx,
    });
  } else {
    events.push({
      key: "pay",
      tone: order.status === "pending" ? "money" : "settled",
      title: `${who === "merchant" ? "Received" : "Paid"} ${amount} USDT`,
      detail: order.status === "pending" ? "Settling on Whitechain." : null,
      at: order.createdAt,
      txHash: order.settleTx,
    });
  }

  const closedAt = order.closedAt ?? null;
  if (order.closeKind === "release") {
    const fee = parseAtomic(order.fee ?? "0", "USDT");
    events.push({
      key: "release",
      tone: "settled",
      title: who === "merchant" ? "Released to you" : "Released to the merchant",
      detail: fee > 0n ? `Toll ${formatUsdt(fee.toString())} USDT.` : null,
      at: order.receivedAt ?? closedAt,
      txHash: order.closeTx ?? null,
      slipHash: order.slipHash ?? null,
    });
  } else if (order.closeKind === "cancel") {
    events.push({
      key: "cancel",
      tone: "neutral",
      title:
        who === "merchant"
          ? `Cancelled. ${amount} USDT returned to the customer`
          : `Cancelled by the merchant. ${amount} USDT returned to you`,
      detail: reasonLabel(order.closeReason),
      at: closedAt,
      txHash: order.closeTx ?? null,
    });
  } else if (order.closeKind === "deadline_refund") {
    events.push({
      key: "deadline",
      tone: "neutral",
      title: `Not delivered in time. ${amount} USDT returned${who === "merchant" ? " to the customer" : " to you"}`,
      at: closedAt,
      txHash: order.closeTx ?? null,
    });
  }

  const records: RefundRecord[] = order.refunds?.length
    ? order.refunds
    : order.refundTxs.map((txHash) => ({ txHash }));
  records.forEach((refund, index) => {
    const value = refund.amount ?? (records.length === 1 ? order.refunded : undefined);
    const shown = value && value !== "0" ? `${formatUsdt(value)} USDT` : null;
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
