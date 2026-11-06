/**
 * Secrets for the human acceptance run, read once through one loader.
 *
 * The process environment wins over the files under ~/.config/countersign, so CI can pass the
 * same names as job secrets. Every value read is registered with the redactor before it is used.
 */

import type { Hex } from "viem";
import { defaultEnvDir, ENV_FILES, Secrets } from "../../lib/secrets.ts";

/** The names this run reads. The reporter registers all of them, set or not. */
export const SECRET_NAMES = ["E2E_HUMAN_FUNDER_KEY", "CS_DEPLOYER_KEY", "PRIVY_TEST_EMAIL", "PRIVY_TEST_OTP"] as const;

/** The suite's files plus privy.env, which holds the test login. */
export const HUMAN_ENV_FILES = [...ENV_FILES, "privy.env"] as const;

export class Keyring {
  readonly secrets: Secrets;

  constructor(secrets?: Secrets) {
    this.secrets = secrets ?? new Secrets(defaultEnvDir(), HUMAN_ENV_FILES);
  }

  static fromEntries(entries: Record<string, string>): Keyring {
    return new Keyring(Secrets.fromEntries(entries));
  }

  /** process.env first, then the files. A missing directory or file is not an error. */
  secret(name: string): string | undefined {
    const env = process.env[name];
    if (env !== undefined && env !== "") {
      this.hide(env);
      return env;
    }
    if (this.secrets.has(name)) {
      const value = this.secrets.get(name);
      this.hide(value);
      return value;
    }
    return undefined;
  }

  /** E2E_HUMAN_FUNDER_KEY in CI, CS_DEPLOYER_KEY on devcube, or undefined. */
  funderKey(): Hex | undefined {
    const value = this.secret("E2E_HUMAN_FUNDER_KEY") ?? this.secret("CS_DEPLOYER_KEY");
    if (value === undefined) return undefined;
    const hex = value.startsWith("0x") ? value : `0x${value}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("the funder key is not a 32-byte hex key");
    return hex as Hex;
  }

  /** Register a value set at run time, with and without its 0x prefix. */
  hide(value: string): void {
    this.secrets.hide(value);
    if (/^0x[0-9a-fA-F]+$/.test(value)) this.secrets.hide(value.slice(2));
  }

  leaks(text: string): boolean {
    return this.secrets.leaks(text);
  }

  redact(text: string): string {
    return this.secrets.redact(text);
  }
}
