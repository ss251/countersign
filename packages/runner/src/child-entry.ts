/**
 * The child entry: read one {spec, input, timeoutMs} request on stdin, run the
 * skill, MCP or OpenAPI adapter and write {output} on stdout. Errors become
 * {error} with a non-zero exit.
 */

import type { ChildSpec, SkillSpec } from "./child.ts";
import { runMcp, type McpSpec, type McpServerRef } from "./mcp.ts";
import { runOpenApi, type OpenApiSpec } from "./openapi.ts";
import { readSkill, runSkill, type SkillInput } from "./skill.ts";

interface ChildRequest {
  spec: ChildSpec;
  input: unknown;
  timeoutMs: number;
}

async function main(): Promise<void> {
  const request = parseRequest(await Bun.stdin.text());
  const output = await run(request);
  console.log(JSON.stringify({ output }));
}

async function run(request: ChildRequest): Promise<unknown> {
  if (request.spec.adapter === "skill") {
    return runSkill(await readSkill(request.spec.skillPath), asSkillInput(request.input));
  }
  if (request.spec.adapter === "mcp") return runMcp(request.spec, request.input);
  return runOpenApi(request.spec, request.input, request.timeoutMs);
}

function parseRequest(raw: string): ChildRequest {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.spec)) {
    throw new Error("The child request is malformed.");
  }
  const timeoutMs = value.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The child request is malformed.");
  }
  const adapter = value.spec.adapter;
  if (adapter === "skill") return { spec: parseSkill(value.spec), input: value.input, timeoutMs };
  if (adapter === "mcp") return { spec: parseMcp(value.spec), input: value.input, timeoutMs };
  if (adapter === "openapi") return { spec: parseOpenApi(value.spec), input: value.input, timeoutMs };
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
  const url = spec.url;
  const method = spec.method;
  if (typeof url !== "string" || typeof method !== "string") {
    throw new Error("The child request is malformed.");
  }
  const parsed: OpenApiSpec = { adapter: "openapi", url, method };
  if (spec.headers !== undefined) {
    if (!isStringRecord(spec.headers)) throw new Error("The child request is malformed.");
    parsed.headers = spec.headers;
  }
  if (spec.bodyField !== undefined) {
    if (typeof spec.bodyField !== "string" || spec.bodyField.length === 0) {
      throw new Error("The child request is malformed.");
    }
    parsed.bodyField = spec.bodyField;
  }
  return parsed;
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
