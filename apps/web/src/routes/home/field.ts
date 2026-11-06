import type { Slip } from "@countersign/core";
import { explorerTemplate, networkName } from "../../lib/format.ts";
import type { RailDeclaration, RailId, Settlement } from "../../lib/types.ts";

/*
 * The landing's honest choices about which payments it may show, kept pure so they are tested.
 */

export const keyOf = (s: Settlement): string => `${s.jobId}-${s.kind}`;

/** Oldest first, ties broken by key so the order never flickers between reads. */
export function byTime(rows: Settlement[]): Settlement[] {
  return [...rows].sort((a, b) => a.at - b.at || keyOf(a).localeCompare(keyOf(b)));
}

/** The newest settlement. */
export function newestOf(rows: Settlement[]): Settlement | undefined {
  const sorted = byTime(rows);
  return sorted[sorted.length - 1];
}

/** The newest release on any rail. The landing's escrow claims follow escrowRelease, never this. */
export function newestRelease(rows: Settlement[]): Settlement | undefined {
  return newestOf(rows.filter((s) => s.kind === "released"));
}

/**
 * The rails whose money waits in a contract: kind escrow, with the contract's address declared
 * (Arc's escrow, Whitechain's). Held Hedera declares kind escrow but names no contract, and its
 * payee's key alone can execute the schedule (audit A4), so it never stands under an escrow claim.
 */
export function contractRails(rails: RailDeclaration[] | undefined): RailId[] {
  return (rails ?? []).filter((r) => r.kind === "escrow" && typeof r.escrow === "string" && r.escrow !== "").map((r) => r.id);
}

/**
 * The newest release from an escrow contract: the only payment the landing follows under "nothing
 * moves until the output checks out". With no rail declarations there is no contract to name, so none.
 */
export function escrowRelease(rows: Settlement[], rails: RailDeclaration[] | undefined): Settlement | undefined {
  const contract = contractRails(rails);
  return newestOf(rows.filter((s) => s.kind === "released" && contract.includes(s.rail)));
}

/** What a rail is called in a plain sentence. */
const SAID: Partial<Record<RailId, string>> = {
  gateway: "Gateway",
  hedera: "Hedera x402",
  eip3009: "Arc USDC transfers",
  mpp: "Stripe MPP",
  erc8183: "ERC-8183",
};

function listed(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The other rails, said plainly from their own declarations: the ones that pay before delivery,
 * and a hold with no contract behind it in A4's plain words. Nothing when the hub declared no rails.
 */
export function otherRailsLines(rails: RailDeclaration[] | undefined): string[] {
  const all = rails ?? [];
  const first = all.filter((r) => r.kind === "direct" || r.kind === "batched").map((r) => SAID[r.id] ?? r.id);
  const contract = contractRails(all);
  const held = all.filter((r) => r.kind === "escrow" && !contract.includes(r.id));
  const lines: string[] = [];
  if (first.length) lines.push(`${listed(first)} ${first.length === 1 ? "pays" : "pay"} the seller before delivery.`);
  if (held.some((r) => r.network.startsWith("hedera:"))) {
    lines.push("Held Hedera moves only when the seller and the hub both sign.");
  }
  return lines;
}

/** The rails to group by: the hub's declared rails in its order, then any rail a settlement names that it no longer declares. */
export function railOrder(rails: RailDeclaration[] | undefined, rows: Settlement[]): RailId[] {
  const ids: RailId[] = (rails ?? []).map((r) => r.id);
  for (const s of rows) if (!ids.includes(s.rail)) ids.push(s.rail);
  return ids;
}

/** The number words groups are counted in. */
export const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** A rail a settlement names that the hub no longer declares: shown, never counted as live. */
export function isRetired(rail: RailId, rails: RailDeclaration[] | undefined): boolean {
  return rails ? !rails.some((r) => r.id === rail) : false;
}

export function retiredLabel(name: string): string {
  return `Retired: ${name}`;
}

/** Beat 2's line: the hub's declared rails only. */
export function railsLine(rails: RailDeclaration[] | undefined, order: RailId[]): string {
  if (rails) {
    const n = rails.length;
    return `On ${WORDS[n] ?? n} live ${n === 1 ? "rail" : "rails"}.`;
  }
  const n = order.length;
  return `On ${WORDS[n] ?? n} ${n === 1 ? "rail" : "rails"}.`;
}

export interface HeldBy {
  /** The escrow contract that held this payment, or undefined until a record names it. */
  escrow: string | undefined;
  escrowHref: string | undefined;
  /** The chain's name, from the payment's own network. */
  chain: string;
  txHref: string | undefined;
}

/**
 * Where this payment waited, from its own records only: the escrow from the seller's slip, else from
 * its own rail's declaration; the chain from its network; links from its own explorer. A record that
 * names no escrow leaves the line out rather than borrow another rail's contract.
 */
export function heldBy(release: Settlement, rails: RailDeclaration[] | undefined, slip: Slip | undefined): HeldBy {
  const declared = rails?.find((r) => r.id === release.rail);
  const escrow = slip?.body.escrow ?? declared?.escrow;
  const template = declared?.explorerTx || explorerTemplate(release.network);
  const at = (path: string) => (template.includes("/tx/{tx}") ? template.replace("/tx/{tx}", path) : undefined);
  return {
    escrow,
    escrowHref: escrow ? at(`/address/${encodeURIComponent(escrow)}`) : undefined,
    chain: networkName(release.network),
    txHref: release.explorer ?? (release.tx ? at(`/tx/${encodeURIComponent(release.tx)}`) : undefined),
  };
}
