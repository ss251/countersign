/**
 * Offline tests of the escrow v2 switch: no keys, no network, no chain. The switch itself is
 * read once when chains.ts is imported, so its env cases run in child processes.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type TransactionReceipt } from "viem";
import { State, type KnownRail } from "@countersign/buyer";
import { ARC, ESCROW_V2_EXTRA, JOB, escrowEvents, type EvmNetwork } from "../lib/chains.ts";

const ROOT = join(import.meta.dir, "..", "..");
const V2 = "0x000000000000000000000000000000000000dEaD";

function run(code: string, env: Record<string, string>): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["bun", "-e", code], {
    cwd: ROOT,
    // Start from neither variable, whatever the test runner's own environment carries.
    env: { ...process.env, E2E_ESCROW_VERSION: "", E2E_ARC_ESCROW_V2: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode ?? 1, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("the escrow version switch", () => {
  test("E2E_ESCROW_VERSION=2 points ARC at the v2 escrow", () => {
    const r = run(
      `import { ARC, ESCROW_VERSION } from "./e2e/lib/chains.ts";
       console.log(JSON.stringify({ escrow: ARC.escrow, escrowVersion: ARC.escrowVersion, version: ESCROW_VERSION }));`,
      { E2E_ESCROW_VERSION: "2", E2E_ARC_ESCROW_V2: V2 },
    );
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { escrow: string; escrowVersion: number; version: number };
    expect(out.escrow.toLowerCase()).toBe(V2.toLowerCase());
    expect(out.escrowVersion).toBe(2);
    expect(out.version).toBe(2);
  });

  test("unset means v1 and the Arc Studio escrow", () => {
    const r = run(
      `import { ARC, ESCROW_VERSION } from "./e2e/lib/chains.ts";
       console.log(JSON.stringify({ escrow: ARC.escrow, escrowVersion: ARC.escrowVersion, version: ESCROW_VERSION }));`,
      {},
    );
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { escrow: string; escrowVersion: number; version: number };
    expect(out.escrow.toLowerCase()).toBe("0x19c27d770969291e6a0a305dc1be1a845e7c1b76");
    expect(out.escrowVersion).toBe(1);
    expect(out.version).toBe(1);
  });

  test("v2 without E2E_ARC_ESCROW_V2 refuses to import chains.ts", () => {
    const r = run(`import "./e2e/lib/chains.ts"; console.log("imported");`, { E2E_ESCROW_VERSION: "2" });
    expect(r.code).not.toBe(0);
    expect(r.stdout).not.toContain("imported");
    expect(r.stderr).toContain("E2E_ESCROW_VERSION=2 needs E2E_ARC_ESCROW_V2");
  });
});

describe("escrow v2 facts", () => {
  test("JOB carries the v2 statuses", () => {
    expect(JOB).toEqual({ None: 0, Funded: 1, Released: 2, Refunded: 3, Failed: 4, Delivered: 5, Disputed: 6 });
  });

  test("escrowEvents decodes a synthetic v2 Delivered log", () => {
    const jobId = `0x${"11".repeat(32)}` as Hex;
    const slipHash = `0x${"22".repeat(32)}` as Hex;
    const topics = encodeEventTopics({
      abi: ESCROW_V2_EXTRA,
      eventName: "Delivered",
      args: { jobId, slipHash },
    });
    const data = encodeAbiParameters(
      [
        { name: "deliveredAt", type: "uint64" },
        { name: "reviewEndsAt", type: "uint64" },
      ],
      [123n, 456n],
    );
    const net: EvmNetwork = { ...ARC, escrow: V2 as Address, escrowVersion: 2 };
    const rcpt = { logs: [{ address: net.escrow, topics, data }] } as unknown as TransactionReceipt;

    const out = escrowEvents(net, rcpt);
    expect(out.delivered).toEqual([{ jobId, slipHash, deliveredAt: 123n, reviewEndsAt: 456n }]);
    expect(out.funded).toEqual([]);
  });
});

describe("the buyer pin", () => {
  test("pinArcV2 writes a rails.json the buyer's KnownRail type accepts, at version 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-pin-"));
    const r = run(
      `import { pinArcV2 } from "./e2e/lib/actors.ts";
       pinArcV2(${JSON.stringify(dir)});`,
      { E2E_ESCROW_VERSION: "2", E2E_ARC_ESCROW_V2: V2 },
    );
    expect(r.code).toBe(0);

    const raw = JSON.parse(readFileSync(join(dir, "rails.json"), "utf8")) as KnownRail[];
    expect(raw).toHaveLength(1);
    const rail = raw[0]!;
    expect(rail.version).toBe(2);
    expect(rail.escrow.toLowerCase()).toBe(V2.toLowerCase());
    expect(rail.network).toBe(`eip155:${ARC.chainId}`);
    expect(rail.scheme).toBe("countersign");

    const loaded: KnownRail[] = new State(dir).loadRails();
    expect(loaded).toEqual(raw);
  });
});
