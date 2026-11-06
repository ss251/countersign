import { formatUnits } from "@countersign/core";
import type { Money, RailId } from "./types.ts";

/**
 * Money for reading: never rounded, at least two decimals, thousands grouped.
 * 50000 atomic USDC reads "0.05"; 1000 reads "0.001"; 1 reads "0.000001".
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

/** Offers price in a 6-decimal USD stablecoin: USDT on Whitechain, USDC everywhere else. */
export function symbolFor(rail: RailId | undefined): string {
  return rail === "whitechain" ? "USDT" : "USDC";
}

export function usd(atomic: string | bigint, rail?: RailId): Money {
  return { amount: atomic.toString(), asset: { symbol: symbolFor(rail), decimals: 6 } };
}

/** Remaining budget, clamped at zero. */
export function remainingAtomic(cap: string, spent: string): string {
  const left = BigInt(cap) - BigInt(spent);
  return (left > 0n ? left : 0n).toString();
}

/** "0x8c1f9e…a20b": enough of each end to compare by eye. */
export function shortHex(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** What the console says for a seller with no name: anonymity is the policy, not a fault. */
export const ANONYMOUS = "anonymous by design";

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} min`;
  if (seconds < 36 * 3600) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const secondsFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fullFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Unix seconds to a Date. */
export const fromUnix = (s: number) => new Date(s * 1000);
export const nowUnix = () => Math.floor(Date.now() / 1000);

export function formatTime(unix: number): string {
  return timeFormat.format(fromUnix(unix));
}

export function formatClock(unix: number): string {
  return secondsFormat.format(fromUnix(unix));
}

export function formatDateTime(unix: number): string {
  return fullFormat.format(fromUnix(unix));
}

const completedFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

/** "6 Nov 2026, 15:18 GMT+5:30": a moment a person can place, never raw ISO. */
export function formatCompleted(unix: number): string {
  return completedFormat.format(fromUnix(unix));
}

export function isoOf(unix: number): string {
  return fromUnix(unix).toISOString();
}

/** "Today", "Yesterday" or "5 Nov". */
/** How long ago, in the fewest words a ledger needs: "just now", "4 min ago", "2 h ago", "3 d ago". */
export function formatAgo(unix: number, now = nowUnix()): string {
  const s = Math.max(0, now - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** Unix seconds at local midnight: where "today" starts for a person reading the desk. */
export function startOfToday(now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function formatDay(unix: number, now = new Date()): string {
  const d = fromUnix(unix);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dayFormat.format(d);
}

/** Rails that settle through CountersignedEscrow: the money waits on chain and a failed delivery returns it. */
export const ESCROW_RAILS: ReadonlySet<RailId> = new Set<RailId>(["escrow", "whitechain", "erc8183"]);

export const RAIL_LABEL: Record<RailId, string> = {
  escrow: "Arc · escrow",
  eip3009: "Arc · USDC transfer",
  gateway: "Arc · Gateway",
  erc8183: "Arc · ERC-8183",
  whitechain: "Whitechain · USDT",
  hedera: "Hedera · x402",
  "hedera-scheduled": "Hedera · scheduled",
  mpp: "Stripe · MPP",
};

/** "eip155:5042002" to a name people know. */
export function networkName(network: string): string {
  switch (network) {
    case "eip155:5042002":
      return "Arc testnet";
    case "eip155:1874":
      return "Whitechain Sepolia";
    case "hedera:testnet":
      return "Hedera testnet";
    case "hedera:mainnet":
      return "Hedera";
    case "mpp:stripe":
      return "Stripe";
    case "mpp:tempo":
      return "Tempo";
    default:
      return network;
  }
}

/** Explorer transaction URL template for a network, with {tx} where the id goes. */
export function explorerTemplate(network: string): string {
  switch (network) {
    case "eip155:5042002":
      return "https://testnet.arcscan.app/tx/{tx}";
    case "eip155:1874":
      return "https://explorer.testnet.whitechain.io/tx/{tx}";
    case "hedera:testnet":
      return "https://hashscan.io/testnet/transaction/{tx}";
    default:
      return "";
  }
}
