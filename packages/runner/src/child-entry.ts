/**
 * The child entry: read one {spec, input} request on stdin, run the skill,
 * MCP or OpenAPI adapter and write {output} on stdout. Errors become {error}
 * with a non-zero exit.
 */

import type { ChildSpec, SkillSpec } from "./child.ts";
import { runMcp, type McpSpec, type McpServerRef } from "./mcp.ts";
import { runOpenApi, type OpenApiSpec } from "./openapi.ts";
import { readSkill, runSkill, type SkillInput } from "./skill.ts";

interface ChildRequest {
  spec: ChildSpec;
  input: unknown;
}

async function main(): Promise<void> {
  const request = parseRequest(await readStdin());
  const spec = request.spec;
  const output =
    spec.adapter === "skill"
      ? runSkill(await readSkill(spec.skillPath), asSkillInput(request.input))
      : spec.adapter === "mcp"
        ? await runMcp(spec, request.input)
        : await runOpenApi(spec, request.input);
  console.log(JSON.stringify({ output }));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequest(raw: string): ChildRequest {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.spec)) {
    throw new Error("The child request is malformed.");
  }
  const adapter = value.spec.adapter;
  if (adapter === "skill") return { spec: parseSkill(value.spec), input: value.input };
  if (adapter === "mcp") return { spec: parseMcp(value.spec), input: value.input };
  if (adapter === "openapi") return { spec: parseOpenApi(value.spec), input: value.input };
  throw new Error("Refused. Unknown adapter.");
}

function parseSkill(spec: Record<string, unknown>): SkillSpec {
  const skillPath = spec.skillPath;
  if (typeof skillPath !== "string") throw new Error("The child request is malformed.");
  return { adapter: "skill", skillPath };
}

function parseMcp(spec: Record<string, unknown>): McpSpec {
  const command = spec.command;
  const args = spec.args;
  const tool = spec.tool;
  if (
    typeof command !== "string" ||
    !Array.isArray(args) ||
    !args.every((arg): arg is string => typeof arg === "string") ||
    typeof tool !== "string"
  ) {
    throw new Error("The child request is malformed.");
  }
  const parsed: McpSpec = { adapter: "mcp", command, args, tool };
  const server = parseServer(spec.server);
  if (server !== undefined) parsed.server = server;
  return parsed;
}

function parseOpenApi(spec: Record<string, unknown>): OpenApiSpec {
  const specPath = spec.specPath;
  const operationId = spec.operationId;
  const baseUrl = spec.baseUrl;
  if (
    typeof specPath !== "string" ||
    typeof operationId !== "string" ||
    typeof baseUrl !== "string"
  ) {
    throw new Error("The child request is malformed.");
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("The child request is malformed.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The child request is malformed.");
  }
  return { adapter: "openapi", specPath, operationId, baseUrl };
}

function parseServer(value: unknown): McpServerRef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.package !== "string" || typeof value.version !== "string") {
    throw new Error("The child request is malformed.");
  }
  return { package: value.package, version: value.version };
}

function asSkillInput(value: unknown): SkillInput {
  if (!isRecord(value)) return {};
  const input: SkillInput = {};
  if (typeof value.question === "string") input.question = value.question;
  if (typeof value.section === "string") input.section = value.section;
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
