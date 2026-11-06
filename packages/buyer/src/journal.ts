import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { parseAtomic, type EnvelopeDecision, type EnvelopeSpend, type Network, type RailId } from "@countersign/core";

/**
 * `accepted` and `disputed` record a decision the agent signed and handed to the hub (escrow v2).
 * Neither closes the job: `resume` closes it once the hub and the chain report the outcome.
 */
export type JournalKind =
  | "countersigned"
  | "signed"
  | "released"
  | "settled"
  | "refused"
  | "failed"
  | "refunded"
  | "accepted"
  | "disputed";

export interface JournalEntry {
  at: number;
  kind: JournalKind;
  offerHash: string;
  seller: string;
  amount: string;
  network?: Network;
  rail?: RailId;
  /** Client-generated id for a reservation made before the jobId exists. */
  reservationId?: string;
  jobId?: string;
  /** The escrow and chain the job was signed for, on escrow rails. */
  escrow?: string;
  chainId?: number;
  /** Escrow v2 terms the buyer countersigned, kept so the jobId can be re-derived. */
  bond?: string;
  reviewWindow?: number;
  slipHash?: string;
  closeTx?: string;
  reason?: string;
}

const CLOSED: JournalKind[] = ["released", "settled", "refunded", "failed"];
const SLEEP = new Int32Array(new SharedArrayBuffer(4));

export class Journal {
  constructor(readonly path: string) {}

  private get lockPath(): string {
    return `${this.path}.lock`;
  }

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

  /**
   * Take the lock, read the journal fresh, decide, and on ok write the reservation before
   * any signature exists. Two buyers racing therefore cannot both pass the envelope.
   */
  reserve(entry: JournalEntry, decide: (spend: EnvelopeSpend) => EnvelopeDecision): EnvelopeDecision {
    const fd = this.acquire();
    try {
      const decision = decide(this.spend());
      if (decision.ok) this.append({ ...entry, kind: "countersigned" });
      return decision;
    } finally {
      closeSync(fd);
      try {
        unlinkSync(this.lockPath);
      } catch {
        // Another process may already have cleared it; the lock is advisory either way.
      }
    }
  }

  private acquire(): number {
    mkdirSync(dirname(this.path), { recursive: true });
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        const fd = openSync(this.lockPath, "wx");
        writeSync(fd, String(process.pid));
        return fd;
      } catch (e) {
        if ((e as { code?: string }).code !== "EEXIST") throw e;
        // A lock left by a process that died is reclaimed rather than waited on.
        if (this.ownerIsGone()) {
          try {
            unlinkSync(this.lockPath);
          } catch {
            // someone else reclaimed it first
          }
          continue;
        }
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for the journal lock at ${this.lockPath}.`);
        Atomics.wait(SLEEP, 0, 0, 10);
      }
    }
  }

  private ownerIsGone(): boolean {
    let pid: number;
    try {
      pid = Number(readFileSync(this.lockPath, "utf8").trim());
    } catch {
      return false;
    }
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (e) {
      return (e as { code?: string }).code === "ESRCH";
    }
  }

  /** Money is committed when reserved and given back when the linked job is refunded. */
  spend(): EnvelopeSpend {
    const all = this.entries();
    const refunded = new Set(all.filter((e) => e.kind === "refunded" && e.jobId).map((e) => (e.jobId as string).toLowerCase()));
    const jobFor = new Map<string, string>();
    const released = new Set<string>();
    for (const e of all) {
      if (e.kind === "signed" && e.reservationId && e.jobId) jobFor.set(e.reservationId, e.jobId);
      if (e.kind === "failed" && e.reservationId) released.add(e.reservationId);
    }
    const counted = new Set<string>();
    let total = 0n;
    const by: Record<string, bigint> = {};
    all.forEach((e, i) => {
      if (e.kind !== "countersigned") return;
      let key: string;
      if (e.reservationId) {
        if (released.has(e.reservationId)) return;
        key = `r:${e.reservationId}`;
        const jobId = jobFor.get(e.reservationId);
        if (jobId && refunded.has(jobId.toLowerCase())) return;
      } else if (e.jobId) {
        key = `j:${e.jobId.toLowerCase()}`;
        if (refunded.has(e.jobId.toLowerCase())) return;
      } else {
        key = `i:${i}`;
      }
      if (counted.has(key)) return;
      counted.add(key);
      const amt = parseAtomic(e.amount);
      const s = e.seller.toLowerCase();
      total += amt;
      by[s] = (by[s] ?? 0n) + amt;
    });
    return {
      total: total.toString(10),
      bySeller: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.toString(10)])),
    };
  }

  /** Reservations that became signed jobs and have no later released, settled, refunded or failed entry. */
  open(): JournalEntry[] {
    const all = this.entries();
    const out: JournalEntry[] = [];
    all.forEach((e, i) => {
      if (!e.jobId) return;
      if (e.kind !== "signed" && e.kind !== "countersigned") return;
      const closed = all.slice(i + 1).some((l) => l.jobId === e.jobId && CLOSED.includes(l.kind));
      if (!closed) out.push(e);
    });
    return out;
  }
}
