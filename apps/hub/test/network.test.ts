import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertBootable,
  BootRefused,
  MAINNET,
  mainnetProblems,
  networkFromEnv,
  pending,
  type MainnetProfile,
} from "../src/network.ts";

const ESCROW = "0x5555555555555555555555555555555555555555";

/** A profile with nothing pending on the escrow and gateway rails. */
const ready: MainnetProfile = {
  ...MAINNET,
  escrow: { chainId: 1, escrow: ESCROW, token: "0x3600000000000000000000000000000000000000", explorerTx: "https://x/tx/{tx}" },
  gateway: { network: "eip155:1", facilitatorUrl: "https://facilitator.example" },
};

function refusal(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof BootRefused) return error.problems;
    throw error;
  }
  throw new Error("expected boot to be refused");
}

describe("networkFromEnv", () => {
  test("unset, empty and testnet mean testnet; mainnet means mainnet", () => {
    expect(networkFromEnv({})).toBe("testnet");
    expect(networkFromEnv({ CS_NETWORK: "" })).toBe("testnet");
    expect(networkFromEnv({ CS_NETWORK: "testnet" })).toBe("testnet");
    expect(networkFromEnv({ CS_NETWORK: "mainnet" })).toBe("mainnet");
  });

  test("any other value refuses boot", () => {
    for (const value of ["Mainnet", "main", "prod", "1"]) {
      expect(refusal(() => networkFromEnv({ CS_NETWORK: value }))[0]).toContain("CS_NETWORK must be testnet or mainnet");
    }
  });
});

describe("the guard knows every rail switch railsFromEnv reads (cs-w1 should-fix on #97)", () => {
  test("EIP3009_RAIL on mainnet is a refusal, not a rail the guard never heard of", () => {
    const problems = mainnetProblems({ EIP3009_RAIL: "1", ARC_RPC_URL: "https://rpc", CS_RELAYER_KEY: "0x01" });
    expect(problems).not.toEqual(["No rail is configured for mainnet."]);
    expect(problems.some((p) => p.startsWith("Rail eip3009 "))).toBe(true);
  });
});

describe("assertBootable", () => {
  test("a testnet hub boots whatever its rails", () => {
    expect(assertBootable({ ARC_ESCROW: ESCROW, ARC_RPC_URL: "https://rpc", HEDERA_RAIL: "1" })).toBe("testnet");
  });

  test("a mainnet hub refuses while the escrow rail is pending, naming each pending value", () => {
    const problems = refusal(() => assertBootable({ CS_NETWORK: "mainnet", ARC_ESCROW: ESCROW, ARC_RPC_URL: "https://rpc" }));
    expect(problems).toEqual([
      expect.stringContaining("Rail escrow chainId is pending"),
      expect.stringContaining("Rail escrow escrow is pending"),
      expect.stringContaining("Rail escrow token is pending"),
      expect.stringContaining("Rail escrow explorerTx is pending"),
    ]);
  });

  test("a mainnet hub refuses a rail with no mainnet, and a hub with no rails at all", () => {
    expect(refusal(() => assertBootable({ CS_NETWORK: "mainnet", HEDERA_RAIL: "1" }))).toEqual([
      expect.stringContaining("Rail hedera has no mainnet"),
    ]);
    expect(refusal(() => assertBootable({ CS_NETWORK: "mainnet", WC_RELAY_URL: "https://relay" }))).toEqual([
      expect.stringContaining("Rail whitechain has no mainnet"),
    ]);
    expect(refusal(() => assertBootable({ CS_NETWORK: "mainnet" }))).toEqual(["No rail is configured for mainnet."]);
  });

  test("one pending value is enough to refuse", () => {
    const one: MainnetProfile = { ...ready, gateway: { ...ready.gateway, facilitatorUrl: pending("not yet") } };
    expect(mainnetProblems({ GATEWAY_RAIL: "1" }, one)).toEqual(["Rail gateway facilitatorUrl is pending: not yet"]);
  });

  test("a ready profile still checks the environment against it", () => {
    expect(mainnetProblems({ ARC_ESCROW: ESCROW, ARC_RPC_URL: "https://rpc" }, ready)).toEqual([]);
    expect(mainnetProblems({ ARC_ESCROW: "0x6666666666666666666666666666666666666666", ARC_RPC_URL: "https://rpc" }, ready)).toEqual([
      "ARC_ESCROW is not the escrow recorded in the mainnet profile.",
    ]);
    expect(mainnetProblems({ ARC_ESCROW: ESCROW }, ready)).toEqual(["ARC_RPC_URL is not set."]);
  });

  test("with nothing pending, mainnet still refuses until mainnet rails are wired", () => {
    expect(refusal(() => assertBootable({ CS_NETWORK: "mainnet", GATEWAY_RAIL: "1" }, ready))[0]).toContain(
      "not wired into the hub yet",
    );
  });
});

describe("the hub process", () => {
  const entry = join(import.meta.dir, "..", "src", "index.ts");

  async function boot(env: Record<string, string>) {
    const child = Bun.spawn([process.execPath, entry], {
      env: { PATH: process.env.PATH ?? "", HUB_DB: ":memory:", PORT: "0", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => child.kill(), 10_000);
    const code = await child.exited;
    clearTimeout(timer);
    return { code, stderr: await new Response(child.stderr).text() };
  }

  test("exits 1 on mainnet while anything is pending, before it listens", async () => {
    const { code, stderr } = await boot({ CS_NETWORK: "mainnet", ARC_ESCROW: ESCROW, ARC_RPC_URL: "https://rpc.invalid" });
    expect(code).toBe(1);
    expect(stderr).toContain("[hub] refused to boot:");
    expect(stderr).toContain("Rail escrow escrow is pending");
    expect(stderr).not.toContain("listening");
  });

  test("exits 1 on an unknown network", async () => {
    const { code, stderr } = await boot({ CS_NETWORK: "prod" });
    expect(code).toBe(1);
    expect(stderr).toContain("CS_NETWORK must be testnet or mainnet");
  });
});
