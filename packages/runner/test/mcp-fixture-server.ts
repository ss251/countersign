/**
 * A tiny stdio MCP server for the adapter tests. It answers from the child's
 * own environment and arguments, so a test can prove both were inherited.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

interface ZodNamespace {
  record(key: AnySchema, value: AnySchema): AnySchema;
  string(): AnySchema;
  unknown(): AnySchema;
}

interface ZodModule {
  z: ZodNamespace;
}

const require = createRequire(import.meta.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { z } = (await import(pathToFileURL(require.resolve("zod")).href)) as ZodModule;

const server = new McpServer({ name: "countersign-mcp-fixture", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Return the call arguments and the server's own arguments.",
    inputSchema: z.record(z.string(), z.unknown()),
  },
  async (args: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify({ ...args, argv: process.argv.slice(2) }) }],
  }),
);

server.registerTool("env", { description: "Return the planted and skill model environment variables." }, async () => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({
        planted: process.env.CS_PLANTED_SECRET ?? null,
        model: process.env.SKILL_MODEL_API_KEY ?? null,
      }),
    },
  ],
}));

server.registerTool("fail", { description: "Fail with a text message." }, async () => ({
  isError: true,
  content: [{ type: "text" as const, text: "the fixture failed as asked" }],
}));

server.registerTool("text", { description: "Return plain non-JSON text." }, async () => ({
  content: [{ type: "text" as const, text: "this is not json" }],
}));

await server.connect(new StdioServerTransport());
