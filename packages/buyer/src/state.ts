import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Envelope, Slip } from "@countersign/core";
import type { KnownRail } from "./known-rails.ts";

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

  saveSlip(slip: Slip): void {
    mkdirSync(join(this.dir, "slips"), { recursive: true });
    writeFileSync(this.slipPath(slip.hash), `${JSON.stringify(slip, null, 2)}\n`);
  }
}
