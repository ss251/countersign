import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "bun";
import { parseBondArgs } from "../src/bond.ts";

const ROOT = join(import.meta.dir, "../../..");
const MESSAGE =
  "Refused. A bond needs --review-window of at least 60 seconds: a bond protects a buyer who can refuse a delivery.";

describe("bond terms", () => {
  test("with --bond 100 and no --review-window exits non-zero with that message", () => {
    const run = spawnSync(
      [
        process.execPath,
        "packages/runner/src/cli.ts",
        "bond",
        "terms",
        "--offer",
        `0x${"aa".repeat(32)}`,
        "--price",
        "500000",
        "--bond",
        "100",
        "--min-duration",
        "120",
        "--escrow",
        "0x4444444444444444444444444444444444444444",
      ],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          CS_SELLER_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr.toString().trim()).toBe(MESSAGE);
    expect(run.stdout.toString()).toBe("");
  });

  test("--review-window 0 with a bond above zero is the same refusal", () => {
    expect(() =>
      parseBondArgs([
        "terms",
        "--offer",
        `0x${"aa".repeat(32)}`,
        "--price",
        "500000",
        "--bond",
        "100",
        "--review-window",
        "0",
        "--min-duration",
        "120",
        "--escrow",
        "0x4444444444444444444444444444444444444444",
      ]),
    ).toThrow(MESSAGE);
  });

  test("--bond 100 --review-window 59 is the same refusal", () => {
    expect(() =>
      parseBondArgs([
        "terms",
        "--offer",
        `0x${"aa".repeat(32)}`,
        "--price",
        "500000",
        "--bond",
        "100",
        "--review-window",
        "59",
        "--min-duration",
        "120",
        "--escrow",
        "0x4444444444444444444444444444444444444444",
      ]),
    ).toThrow(MESSAGE);
  });
});
