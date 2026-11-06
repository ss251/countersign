export type SpendCeilingConfig = {
  windowMs: number;
  capWei: bigint;
  maxTx: number;
  maxTxPerPayer: number;
};

export type CeilingRefusal = "ceiling_wei" | "ceiling_tx" | "ceiling_payer";

export type CeilingTicket = {
  id: number;
  payer: string;
  at: number;
  wei: bigint;
};

export type CeilingSnapshot = {
  windowMs: number;
  capWei: bigint;
  usedWei: bigint;
  remainingWei: bigint;
  txCount: number;
  maxTx: number;
  resetsAt: number;
};

export type ReserveResult =
  | { ok: true; ticket: CeilingTicket }
  | { ok: false; reason: CeilingRefusal };

export class SpendCeiling {
  private entries: CeilingTicket[] = [];
  private nextId = 1;

  constructor(
    private readonly cfg: SpendCeilingConfig,
    private readonly now: () => number = Date.now,
  ) {}

  seed(entries: readonly { payer: string; costWei: bigint; at: number }[]): void {
    for (const entry of entries) {
      this.entries.push({
        id: this.nextId++,
        payer: entry.payer,
        at: entry.at,
        wei: entry.costWei,
      });
    }
  }

  reserve(input: { payer: string; worstCaseWei: bigint }): ReserveResult {
    const at = this.now();
    this.prune(at);
    const used = this.usedWei();
    if (used + input.worstCaseWei > this.cfg.capWei) {
      return { ok: false, reason: "ceiling_wei" };
    }
    if (this.entries.length + 1 > this.cfg.maxTx) {
      return { ok: false, reason: "ceiling_tx" };
    }
    const payerTx = this.entries.filter((entry) => sameAddress(entry.payer, input.payer)).length;
    if (payerTx + 1 > this.cfg.maxTxPerPayer) {
      return { ok: false, reason: "ceiling_payer" };
    }
    const ticket: CeilingTicket = {
      id: this.nextId++,
      payer: input.payer,
      at,
      wei: input.worstCaseWei,
    };
    this.entries.push(ticket);
    return { ok: true, ticket };
  }

  settle(ticket: CeilingTicket, actualWei: bigint): void {
    const entry = this.entries.find((candidate) => candidate.id === ticket.id);
    if (!entry) return;
    entry.wei = actualWei < 0n ? 0n : actualWei;
  }

  cancel(ticket: CeilingTicket): void {
    this.entries = this.entries.filter((entry) => entry.id !== ticket.id);
  }

  snapshot(): CeilingSnapshot {
    const at = this.now();
    this.prune(at);
    const usedWei = this.usedWei();
    const remainingWei = usedWei >= this.cfg.capWei ? 0n : this.cfg.capWei - usedWei;
    const resetsAt =
      this.entries.length === 0
        ? at + this.cfg.windowMs
        : Math.min(...this.entries.map((entry) => entry.at + this.cfg.windowMs));
    return {
      windowMs: this.cfg.windowMs,
      capWei: this.cfg.capWei,
      usedWei,
      remainingWei,
      txCount: this.entries.length,
      maxTx: this.cfg.maxTx,
      resetsAt,
    };
  }

  private prune(at: number): void {
    const cutoff = at - this.cfg.windowMs;
    this.entries = this.entries.filter((entry) => entry.at > cutoff);
  }

  private usedWei(): bigint {
    return this.entries.reduce((total, entry) => total + entry.wei, 0n);
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
