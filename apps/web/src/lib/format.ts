import { formatUnits } from "@countersign/core";
import type { Money, RailId } from "./types.ts";

/**
 * Money for reading: never rounded, at least two decimals, thousands grouped.
 * 50000 atomic USDC is "0.05"; 1000 is "0.001"; 1 is "0.000001".
 */
export function formatAmount(money: Money, minDecimals = 2): string {
  const exact = formatUnits(BigInt(money.amount), money.asset.decimals);
  const [whole = "0", frac = ""] = exact.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = frac.length >= minDecimals ? frac : frac.padEnd(Math.min(minDecimals, money.asset.decimals), "0");
  return decimals ? `${grouped}.${decimals}` : grouped;
}

export function formatMoney(money: Money): string {
  return `${formatAmount(money)} ${money.asset.symbol}`;
}

/** Remaining budget, clamped at zero. */
export function remaining(cap: Money, spent: Money): Money {
  const left = BigInt(cap.amount) - BigInt(spent.amount);
  return { amount: (left > 0n ? left : 0n).toString(), asset: cap.asset };
}

/** "0x8c1f9e…a20b": enough of each end to compare by eye. */
export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return fullFormat.format(new Date(iso));
}

/** "Today", "Yesterday" or "5 Nov". */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dayFormat.format(d);
}

export const RAIL_LABEL: Record<RailId, string> = {
  arc: "Arc · escrow",
  "arc-gateway": "Arc · gateway",
  whitechain: "Whitechain · USDT",
  hedera: "Hedera · x402",
  erc8183: "Arc · ERC-8183",
};

export const RAIL_NETWORK: Record<RailId, string> = {
  arc: "Arc testnet",
  "arc-gateway": "Circle Gateway",
  whitechain: "Whitechain Sepolia",
  hedera: "Hedera testnet",
  erc8183: "Arc testnet",
};
