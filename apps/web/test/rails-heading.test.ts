import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RailDeclaration, RailId, Settlement } from "../src/lib/types.ts";
import { isRetired, otherRailsLines, railOrder, railsLine, retiredLabel } from "../src/routes/home/field.ts";

function declaration(
  id: RailId,
  network: RailDeclaration["network"],
  kind: RailDeclaration["kind"],
  escrow?: string,
): RailDeclaration {
  return {
    id,
    network,
    scheme: "exact",
    asset: { network, address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
    kind,
    escrow,
    gasPaidBy: "hub",
    finality: "One block.",
    explorerTx: "https://example.test/tx/{tx}",
  };
}

// The hub tonight: three live rails. Gateway and plain Hedera are retired settlements, not declarations.
const LIVE = [
  declaration("escrow", "eip155:5042002", "escrow", "0x19c27D770969291E6A0a305dc1Be1a845E7c1b76"),
  declaration("whitechain", "eip155:1874", "escrow", "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4"),
  declaration("hedera-scheduled", "hedera:testnet", "escrow"),
];

function row(rail: RailId, i: number): Settlement {
  return {
    jobId: `0x${i.toString(16)}`,
    offerHash: "0xoffer",
    title: `offer ${i}`,
    seller: "0x6be9805162d0f7ae6000000000000000000ca4a",
    amount: "10000",
    rail,
    network: rail === "hedera" || rail === "hedera-scheduled" ? "hedera:testnet" : "eip155:5042002",
    kind: rail === "escrow" || rail === "whitechain" || rail === "hedera-scheduled" ? "released" : "settled",
    tx: `0xtx${i}`,
    at: 1_793_960_000 + i,
  };
}

describe("beat 2 counts only the rails the hub declares live", () => {
  test("retired settlements stay in the field but not in the heading", () => {
    const rows = (["escrow", "whitechain", "hedera-scheduled", "gateway", "hedera"] as RailId[]).map(row);
    const order = railOrder(LIVE, rows);
    expect(order).toEqual(["escrow", "whitechain", "hedera-scheduled", "gateway", "hedera"]);
    expect(railsLine(LIVE, order)).toBe("On three live rails.");
    expect(railsLine(LIVE.slice(0, 1), ["escrow"])).toBe("On one live rail.");
  });

  test("unknown hub rails keep the old line, with no claim of live", () => {
    expect(railsLine(undefined, ["escrow", "gateway"])).toBe("On two rails.");
  });
});

describe("a rail named only by a settlement is retired, never live", () => {
  test("gateway is retired against the three declarations, escrow is not, and unknown rails retire nothing", () => {
    expect(isRetired("gateway", LIVE)).toBe(true);
    expect(isRetired("escrow", LIVE)).toBe(false);
    expect(isRetired("gateway", undefined)).toBe(false);
    expect(retiredLabel("Arc · Gateway")).toBe("Retired: Arc · Gateway");
  });
});

describe("held Hedera needs both signatures", () => {
  test("the held line says the seller and the hub both sign", () => {
    const held = declaration("hedera", "hedera:testnet", "escrow");
    expect(otherRailsLines([...LIVE, held])).toContain("Held Hedera moves only when the seller and the hub both sign.");
  });

  test("no home copy still says the seller's key alone can release a held payment", () => {
    const files = walk(join(import.meta.dir, "../src/routes/home"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(readFileSync(file, "utf8")).not.toContain("release it without delivering");
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
