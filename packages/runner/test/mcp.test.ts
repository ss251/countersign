import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalHash } from "@countersign/core";
import { runInChild, type ChildSpec } from "../src/child.ts";
import { substituteBuyer, childEnvironment, type McpSpec } from "../src/mcp.ts";

const FIXTURE = join(import.meta.dir, "mcp-fixture-server.ts");
const LIMITS = { timeMs: 20_000, maxOutputBytes: 200_000 };

function mcpSpec(overrides: Partial<McpSpec> = {}): McpSpec {
  return {
    adapter: "mcp",
    command: process.execPath,
    args: [FIXTURE, "--fixture-flag"],
    tool: "echo",
    server: { package: "@countersign/mcp-fixture", version: "1.0.0" },
    ...overrides,
  };
}

interface McpOutput {
  tool: string;
  server: { name: string; version: string } | null;
  package: { package: string; version: string } | null;
  inputHash: string;
  result: unknown;
}

describe("runMcp", () => {
  test("calls the tool with the input and reports the server and hashes", async () => {
    const input = { question: "hello", count: 2 };
    const output = (await runInChild(mcpSpec(), input, LIMITS)) as McpOutput;

    expect(output.tool).toBe("echo");
    expect(output.server).toEqual({ name: "countersign-mcp-fixture", version: "1.0.0" });
    expect(output.package).toEqual({ package: "@countersign/mcp-fixture", version: "1.0.0" });
    expect(output.inputHash).toBe(canonicalHash(input));
    expect(output.result).toEqual({
      question: "hello",
      count: 2,
      argv: ["--fixture-flag"],
    });
  });

  test("parses JSON text and keeps plain text as text", async () => {
    const output = (await runInChild(mcpSpec({ tool: "text" }), {}, LIMITS)) as McpOutput;
    expect(output.result).toEqual({ text: "this is not json" });
  });

  test("fails cleanly with the tool's message", async () => {
    await expect(runInChild(mcpSpec({ tool: "fail" }), {}, LIMITS)).rejects.toThrow(
      "the fixture failed as asked",
    );
  });

  test("runs with only the child's scrubbed environment", async () => {
    const previous = process.env.CS_PLANTED_SECRET;
    process.env.CS_PLANTED_SECRET = "planted";
    try {
      const output = (await runInChild(mcpSpec({ tool: "env" }), {}, LIMITS)) as McpOutput;
      expect(output.result).toEqual({ planted: null, model: null });
    } finally {
      if (previous === undefined) delete process.env.CS_PLANTED_SECRET;
      else process.env.CS_PLANTED_SECRET = previous;
    }
  });

  test("an mcp server never sees the seller's model credential", async () => {
    const previous = process.env.SKILL_MODEL_API_KEY;
    process.env.SKILL_MODEL_API_KEY = "sk-seller";
    try {
      const output = (await runInChild(mcpSpec({ tool: "env" }), {}, LIMITS)) as McpOutput;
      expect(output.result).toEqual({ planted: null, model: null });
    } finally {
      if (previous === undefined) delete process.env.SKILL_MODEL_API_KEY;
      else process.env.SKILL_MODEL_API_KEY = previous;
    }
  });

  test("the child entry refuses an unknown adapter", async () => {
    const spec = { adapter: "http" } as unknown as ChildSpec;
    await expect(runInChild(spec, {}, LIMITS)).rejects.toThrow("Refused. Unknown adapter.");
  });
});

describe("substituteBuyer", () => {
  test("replaces a whole {buyer} argument with a hedera account id", () => {
    const spec = mcpSpec({ args: [FIXTURE, "--account-id", "{buyer}"] });
    const substituted = substituteBuyer(spec, "0.0.1234");
    if (substituted.adapter !== "mcp") throw new Error("expected an mcp spec");
    expect(substituted.args).toEqual([FIXTURE, "--account-id", "0.0.1234"]);
  });

  test("replaces a whole {buyer} argument with an EVM address", () => {
    const buyer = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const spec = mcpSpec({ args: ["{buyer}"] });
    const substituted = substituteBuyer(spec, buyer);
    if (substituted.adapter !== "mcp") throw new Error("expected an mcp spec");
    expect(substituted.args).toEqual([buyer]);
  });

  test("refuses a malformed buyer", () => {
    const spec = mcpSpec({ args: [FIXTURE, "{buyer}"] });
    expect(() => substituteBuyer(spec, "0.0.1;rm -rf /")).toThrow(
      "Refused. The buyer id cannot be passed to the tool.",
    );
  });

  test("never substitutes inside a longer string", () => {
    const spec = mcpSpec({ args: [`--account-id={buyer}`, "prefix{buyer}"] });
    const substituted = substituteBuyer(spec, "0.0.1234");
    if (substituted.adapter !== "mcp") throw new Error("expected an mcp spec");
    expect(substituted.args).toEqual(["--account-id={buyer}", "prefix{buyer}"]);
  });

  test("leaves any other spec unchanged", () => {
    const spec: ChildSpec = { adapter: "skill", skillPath: "/tmp/SKILL.md" };
    expect(substituteBuyer(spec, "0.0.1234")).toBe(spec);
  });
});

describe("childEnvironment", () => {
  test("drops every SKILL_MODEL variable, whichever name it has", () => {
    const env = childEnvironment({
      PATH: "/bin",
      HOME: "/tmp/home",
      COUNTERSIGN_LINEAGE: "0xlineage",
      SKILL_MODEL_API_KEY: "sk-seller",
      SKILL_MODEL_BASE_URL: "https://models.example",
      SKILL_MODEL: "seller-model",
      SKILL_MODEL_EXTRA: "extra",
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/tmp/home", COUNTERSIGN_LINEAGE: "0xlineage" });
  });
});
