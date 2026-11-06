import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const cwd = join(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "cs-mcp-redaction-"));
const children: Client[] = [];

afterAll(async () => {
  for (const client of children) await client.close().catch(() => undefined);
});

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

describe("the agent key never leaks", () => {
  test("no tool result or stderr line contains any piece of the key", async () => {
    const key = generatePrivateKey();
    const address = privateKeyToAccount(key).address;
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["src/cli.ts", "--hub", "http://127.0.0.1:9"],
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: home, CS_BUYER_KEY: key },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    const client = new Client({ name: "countersign-mcp-redaction", version: "0.0.0" });
    children.push(client);
    await client.connect(transport);

    const listed = await client.listTools();
    const results = [
      listed,
      await call(client, "search_offers"),
      await call(client, "buy", { offerHash: `0x${"11".repeat(32)}`, input: { q: "hi" } }),
      await call(client, "envelope_show"),
      await call(client, "journal"),
    ];
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const haystack = `${JSON.stringify(results)}\n${stderr}`.toLowerCase();
    const hex = key.slice(2).toLowerCase();
    expect(haystack).not.toContain(hex);
    expect(haystack).not.toContain(`0x${hex}`);
    for (let start = 0; start + 20 <= hex.length; start++) {
      expect(haystack).not.toContain(hex.slice(start, start + 20));
    }
    expect(haystack).toContain(address.toLowerCase());
  });
});
