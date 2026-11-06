import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LAUNCHER = join(import.meta.dir, "..", "agent-kit-mcp.ts");

describe("agent-kit-mcp", () => {
  test(
    "lists only the HBAR transfer tool",
    async () => {
      const client = new Client({ name: "countersign-test", version: "0.0.0" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [LAUNCHER, "--account-id", "0.0.1234"],
        stderr: "ignore",
      });
      try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(1);
        const tool = tools[0];
        if (tool === undefined) throw new Error("the server listed no tools");
        expect(tool.name).toBe("transfer_hbar_tool");
        expect(tool.inputSchema.type).toBe("object");
        const properties = tool.inputSchema.properties;
        if (!isRecord(properties)) throw new Error("the input schema has no properties");
        expect(properties.transfers).toBeDefined();
      } finally {
        await client.close().catch(() => undefined);
      }
    },
    60_000,
  );

  test("exits 2 on a bad account id", async () => {
    const proc = Bun.spawn([process.execPath, LAUNCHER, "--account-id", "0.0.1;id"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(2);
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toContain("--account-id");
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
