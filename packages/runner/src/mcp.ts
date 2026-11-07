/**
 * The mcp adapter: spawn an MCP server as a child, call one tool with the job
 * input, and return what the tool said.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import { canonicalHash } from "@countersign/core";
import type { Hex } from "./account.ts";
import type { ChildSpec } from "./child.ts";

export interface McpServerRef {
  package: string;
  version: string;
}

export interface McpSpec {
  adapter: "mcp";
  command: string;
  args: string[];
  tool: string;
  server?: McpServerRef;
}

export interface McpOutput {
  tool: string;
  server: { name: string; version: string } | null;
  package: McpServerRef | null;
  inputHash: Hex;
  result: unknown;
}

const BUYER_ID = /^(0\.0\.\d+|0x[0-9a-fA-F]{40})$/;
const BARE_COMMAND = /^[A-Za-z0-9._+-]+$/;
const FAILURE_LIMIT = 500;

/** Replace a whole `{buyer}` argument, and refuse a buyer id that is not one. */
export function substituteBuyer(spec: ChildSpec, buyer: string): ChildSpec {
  if (spec.adapter !== "mcp") return spec;
  if (!BUYER_ID.test(buyer)) {
    throw new Error("Refused. The buyer id cannot be passed to the tool.");
  }
  return { ...spec, args: spec.args.map((arg) => (arg === "{buyer}" ? buyer : arg)) };
}

/** Run one MCP tool in a fresh server process and return the mapped result. */
export async function runMcp(spec: McpSpec, input: unknown): Promise<McpOutput> {
  if (!isRecord(input)) throw new Error("The input must be a JSON object.");
  if (!BARE_COMMAND.test(spec.command) && !spec.command.startsWith("/")) {
    throw new Error("Refused. The MCP command must be a bare name or an absolute path.");
  }

  const transport = new StdioClientTransport({
    command: spec.command,
    args: spec.args,
    env: childEnvironment(),
    stderr: "ignore",
  });
  const client = new Client({ name: "countersign-runner", version: "0.0.0" });

  try {
    await client.connect(transport);
    const result = (await client.callTool({
      name: spec.tool,
      arguments: input,
    })) as unknown as CallToolResult;
    if (result.isError === true) {
      throw new Error(cut(textOf(result) || "The tool failed."));
    }
    const implementation = client.getServerVersion();
    return {
      tool: spec.tool,
      server:
        implementation === undefined
          ? null
          : { name: implementation.name, version: implementation.version },
      package: spec.server ?? null,
      inputHash: canonicalHash(input),
      result: mapResult(result),
    };
  } catch (error) {
    throw new Error(cut(messageOf(error)));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function mapResult(result: CallToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const only = result.content.length === 1 ? result.content[0] : undefined;
  if (only !== undefined && only.type === "text") {
    try {
      return JSON.parse(only.text) as unknown;
    } catch {
      return { text: only.text };
    }
  }
  return { text: textOf(result) };
}

function textOf(result: CallToolResult): string {
  const texts = result.content.filter((item): item is TextContent => item.type === "text");
  return texts.map((item) => item.text).join("\n");
}

/** The child's own environment, which the runner already scrubbed to PATH and HOME. */
export function childEnvironment(
  parent: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && !name.startsWith("SKILL_MODEL")) env[name] = value;
  }
  return env;
}

function cut(text: string): string {
  return text.length > FAILURE_LIMIT ? text.slice(0, FAILURE_LIMIT) : text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
