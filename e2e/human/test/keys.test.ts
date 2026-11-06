import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Secrets } from "../../lib/secrets.ts";
import { Keyring } from "../lib/keys.ts";

const dirs: string[] = [];
const envNames = ["PRIVY_TEST_OTP", "PRIVY_TEST_EMAIL", "E2E_HUMAN_FUNDER_KEY", "CS_DEPLOYER_KEY"] as const;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cs-human-keys-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const name of envNames) delete process.env[name];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the secrets loader", () => {
  test("the process environment wins over a file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "e2e.env"), "PRIVY_TEST_OTP=from-the-file\n");
    process.env.PRIVY_TEST_OTP = "from-the-environment";
    const keys = new Keyring(new Secrets(dir));
    expect(keys.secret("PRIVY_TEST_OTP")).toBe("from-the-environment");
  });

  test("reads a file value when the environment has none", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "e2e.env"), "PRIVY_TEST_EMAIL=tester@example.test\n");
    const keys = new Keyring(new Secrets(dir));
    expect(keys.secret("PRIVY_TEST_EMAIL")).toBe("tester@example.test");
  });

  test("a missing directory is not an error", () => {
    const keys = new Keyring(new Secrets(join(tempDir(), "missing")));
    expect(keys.secret("PRIVY_TEST_OTP")).toBeUndefined();
    expect(keys.funderKey()).toBeUndefined();
  });

  test("every value read is registered for redaction", () => {
    const dir = tempDir();
    const key = `0x${"ab".repeat(32)}`;
    writeFileSync(join(dir, "e2e.env"), `E2E_HUMAN_FUNDER_KEY=${key}\n`);
    const keys = new Keyring(new Secrets(dir));
    expect(keys.secret("E2E_HUMAN_FUNDER_KEY")).toBe(key);
    expect(keys.leaks(`the key is ${key}`)).toBe(true);
    expect(keys.leaks(`without the prefix ${key.slice(2)}`)).toBe(true);
    expect(keys.redact(key)).toBe("[redacted]");
  });

  test("registers an environment-only value", () => {
    const keys = new Keyring(Secrets.fromEntries({}));
    process.env.PRIVY_TEST_EMAIL = "operator@example.test";
    expect(keys.secret("PRIVY_TEST_EMAIL")).toBe("operator@example.test");
    expect(keys.leaks("mail to operator@example.test")).toBe(true);
  });

  test("falls back to the deployer key and reports a bad shape", () => {
    const dir = tempDir();
    const key = `0x${"cd".repeat(32)}` as `0x${string}`;
    writeFileSync(join(dir, "e2e.env"), `CS_DEPLOYER_KEY=${key}\n`);
    const keys = new Keyring(new Secrets(dir));
    expect(keys.funderKey()).toBe(key);

    process.env.E2E_HUMAN_FUNDER_KEY = "not-a-key";
    const bad = new Keyring(new Secrets(join(dir, "missing")));
    expect(() => bad.funderKey()).toThrow("32-byte hex key");
  });
});
