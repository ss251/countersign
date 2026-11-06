import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseAtomic, type EnvelopeSpend, type RailId } from "@countersign/core";

export type JournalKind = "countersigned" | "released" | "settled" | "refused" | "failed" | "refunded";

export interface JournalEntry {
  at: number;
  kind: JournalKind;
  offerHash: string;
  seller: string;
  amount: string;
  rail?: RailId;
  jobId?: string;
  slipHash?: string;
  closeTx?: string;
  reason?: string;
}

const CLOSED: JournalKind[] = ["released", "settled", "refunded", "failed"];

export class Journal {
  constructor(readonly path: string) {}

  append(entry: JournalEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }

  entries(): JournalEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as JournalEntry);
  }

  /** Money is committed when signed and given back when refunded. */
  spend(): EnvelopeSpend {
    const all = this.entries();
    const refunded = new Set(all.filter((e) => e.kind === "refunded" && e.jobId).map((e) => e.jobId));
    const counted = new Set<string>();
    let total = 0n;
    const by: Record<string, bigint> = {};
    for (const e of all) {
      if (e.kind !== "countersigned") continue;
      if (e.jobId) {
        if (counted.has(e.jobId) || refunded.has(e.jobId)) continue;
        counted.add(e.jobId);
      }
      const amt = parseAtomic(e.amount);
      const s = e.seller.toLowerCase();
      total += amt;
      by[s] = (by[s] ?? 0n) + amt;
    }
    return {
      total: total.toString(10),
      bySeller: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.toString(10)])),
    };
  }

  /** Countersigned entries with no later released, settled, refunded or failed entry. */
  open(): JournalEntry[] {
    const all = this.entries();
    const out: JournalEntry[] = [];
    all.forEach((e, i) => {
      if (e.kind !== "countersigned" || !e.jobId) return;
      const closed = all.slice(i + 1).some((l) => l.jobId === e.jobId && CLOSED.includes(l.kind));
      if (!closed) out.push(e);
    });
    return out;
  }
}
