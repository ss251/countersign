/**
 * Testnet keys, read once from the env files outside the repository.
 *
 * A value read here goes to a child process by environment or into an in-process signer, and
 * nowhere else. Everything the suite writes or prints passes through redact() first.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/** Read in this order; the first file that defines a name wins. */
export const ENV_FILES = ["e2e.env", "cs.env", "wc.env", "hd.env"] as const;

/** Names whose values are public: addresses, EVM aliases and Hedera ids. */
const PUBLIC_NAME = /(_ADDRESS|_EVM|_ID)$/;

/** Shorter values are never treated as secrets, so redaction cannot eat ordinary text. */
const MIN_SECRET_LENGTH = 16;

export function defaultEnvDir(): string {
  return process.env.E2E_ENV_DIR ?? join(homedir(), ".config", "countersign");
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    out.set(m[1] as string, value);
  }
  return out;
}

export class Secrets {
  readonly dir: string;
  private readonly values = new Map<string, string>();
  private readonly hidden: string[] = [];
  private readonly patterns = new Map<string, RegExp>();

  constructor(dir: string = defaultEnvDir(), files: readonly string[] = ENV_FILES) {
    this.dir = dir;
    const hidden = new Set<string>();
    for (const file of files) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      for (const [name, value] of parseEnv(readFileSync(path, "utf8"))) {
        if (!this.values.has(name)) this.values.set(name, value);
        if (!PUBLIC_NAME.test(name) && value.length >= MIN_SECRET_LENGTH) {
          hidden.add(value);
          if (/^0x[0-9a-fA-F]+$/.test(value)) hidden.add(value.slice(2));
        }
      }
    }
    // Longest first, so no fragment of a longer secret survives a shorter replacement.
    this.hidden = [...hidden].sort((a, b) => b.length - a.length);
  }

  /** For tests: a Secrets built from literal values, no files read. */
  static fromEntries(entries: Record<string, string>): Secrets {
    const s = new Secrets("(memory)", []);
    const hidden = new Set<string>();
    for (const [name, value] of Object.entries(entries)) {
      s.values.set(name, value);
      if (!PUBLIC_NAME.test(name) && value.length >= MIN_SECRET_LENGTH) {
        hidden.add(value);
        if (/^0x[0-9a-fA-F]+$/.test(value)) hidden.add(value.slice(2));
      }
    }
    s.hidden.push(...[...hidden].sort((a, b) => b.length - a.length));
    return s;
  }

  /** Treat a value made at run time, such as a fresh server secret, as secret from now on. */
  hide(value: string): void {
    if (value.length < MIN_SECRET_LENGTH || this.hidden.includes(value)) return;
    this.hidden.push(value);
    this.hidden.sort((a, b) => b.length - a.length);
  }

  has(name: string): boolean {
    const v = this.values.get(name);
    return v !== undefined && v !== "";
  }

  /** Any value by name. Throws naming the variable, never the value. */
  get(name: string): string {
    const v = this.values.get(name);
    if (v === undefined || v === "") throw new Error(`${name} is not set in ${this.dir}`);
    return v;
  }

  /** A 0x-prefixed EVM private key. */
  key(name: string): Hex {
    const v = this.get(name);
    const hex = v.startsWith("0x") ? v : `0x${v}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} is not a 32-byte hex key`);
    return hex as Hex;
  }

  account(name: string): PrivateKeyAccount {
    return privateKeyToAccount(this.key(name));
  }

  address(name: string): Address {
    const v = this.get(name);
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) throw new Error(`${name} is not an address`);
    return v as Address;
  }

  /** True when the text holds any secret value, in any letter case. */
  leaks(text: string): boolean {
    return this.redact(text) !== text;
  }

  /** Replace every secret value, with or without its 0x and in any letter case, by [redacted]. */
  redact(text: string): string {
    let out = text;
    for (const v of this.hidden) {
      if (!this.patterns.has(v)) {
        const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        this.patterns.set(v, new RegExp(escaped, /^(0x)?[0-9a-fA-F]+$/.test(v) ? "gi" : "g"));
      }
      out = out.replace(this.patterns.get(v) as RegExp, "[redacted]");
    }
    return out;
  }
}
