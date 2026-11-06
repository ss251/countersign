import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Envelope, Slip } from "@countersign/core";
import type { KnownRail } from "./known-rails.ts";

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

export class State {
  readonly dir: string;
  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), ".countersign");
  }

  get envelopePath(): string {
    return join(this.dir, "envelope.json");
  }
  get journalPath(): string {
    return join(this.dir, "journal.jsonl");
  }
  get railsPath(): string {
    return join(this.dir, "rails.json");
  }
  get consumedApprovalsPath(): string {
    return join(this.dir, "approvals-consumed.json");
  }
  slipPath(hash: string): string {
    return join(this.dir, "slips", `${hash}.json`);
  }

  loadEnvelope(): Envelope {
    if (!existsSync(this.envelopePath)) {
      throw new Error(
        `No envelope at ${this.envelopePath}. Create one with: countersign envelope set --cap <usd> --per-merchant <usd>`,
      );
    }
    return JSON.parse(readFileSync(this.envelopePath, "utf8")) as Envelope;
  }

  saveEnvelope(env: Envelope): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.envelopePath, `${JSON.stringify(env, null, 2)}\n`);
  }

  /** Extra rails a local deployment trusts, e.g. an anvil escrow. */
  loadRails(): KnownRail[] {
    if (!existsSync(this.railsPath)) return [];
    const value = JSON.parse(readFileSync(this.railsPath, "utf8")) as unknown;
    if (!Array.isArray(value)) throw new Error(`${this.railsPath} must hold a JSON array of known rails.`);
    return value as KnownRail[];
  }

  loadSlip(hash: string): Slip {
    return JSON.parse(readFileSync(this.slipPath(hash), "utf8")) as Slip;
  }

  loadConsumedApprovals(): string[] {
    if (!existsSync(this.consumedApprovalsPath)) return [];
    const value = JSON.parse(readFileSync(this.consumedApprovalsPath, "utf8")) as unknown;
    if (!Array.isArray(value)) {
      throw new Error(`${this.consumedApprovalsPath} must hold a JSON array of approval ids.`);
    }
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  hasConsumedApproval(id: string): boolean {
    return this.loadConsumedApprovals().includes(id);
  }

  /** Record an approval id once. False when another call already consumed it. */
  consumeApproval(id: string): boolean {
    const fd = this.acquireConsumedLock();
    try {
      const ids = this.loadConsumedApprovals();
      if (ids.includes(id)) return false;
      ids.push(id);
      writeFileSync(this.consumedApprovalsPath, `${JSON.stringify(ids, null, 2)}\n`, { mode: 0o600 });
      chmodSync(this.consumedApprovalsPath, 0o600);
      return true;
    } finally {
      closeSync(fd);
      try {
        unlinkSync(this.consumedLockPath);
      } catch {
        // Another process may already have cleared it; the lock is advisory either way.
      }
    }
  }

  private get consumedLockPath(): string {
    return `${this.consumedApprovalsPath}.lock`;
  }

  private acquireConsumedLock(): number {
    mkdirSync(this.dir, { recursive: true });
    const deadline = Date.now() + 5_000;
    for (;;) {
      try {
        const fd = openSync(this.consumedLockPath, "wx");
        writeSync(fd, String(process.pid));
        return fd;
      } catch (e) {
        if ((e as { code?: string }).code !== "EEXIST") throw e;
        if (this.consumedLockOwnerIsGone()) {
          try {
            unlinkSync(this.consumedLockPath);
          } catch {
            // someone else reclaimed it first
          }
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for the approval lock at ${this.consumedLockPath}.`);
        }
        Atomics.wait(SLEEP, 0, 0, 10);
      }
    }
  }

  private consumedLockOwnerIsGone(): boolean {
    let pid: number;
    try {
      pid = Number(readFileSync(this.consumedLockPath, "utf8").trim());
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

  saveSlip(slip: Slip): void {
    mkdirSync(join(this.dir, "slips"), { recursive: true });
    writeFileSync(this.slipPath(slip.hash), `${JSON.stringify(slip, null, 2)}\n`);
  }
}
