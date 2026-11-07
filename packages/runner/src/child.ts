/**
 * The scrubbed child: a job runs in its own process with only PATH and a
 * throwaway HOME, under a time ceiling and an output-size ceiling.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpSpec } from "./mcp.ts";
import type { OpenApiSpec } from "./openapi.ts";

export class CeilingError extends Error {
  override name = "CeilingError";
}

export interface ChildLimits {
  timeMs: number;
  maxOutputBytes: number;
}

export interface SkillSpec {
  adapter: "skill";
  skillPath: string;
}

export type ChildSpec = SkillSpec | McpSpec | OpenApiSpec;

/** The child entry beside this file: child-entry.js in a Node bundle, else the TypeScript source, which Bun runs. */
export function childEntryPath(): string {
  const bundled = fileURLToPath(new URL("./child-entry.js", import.meta.url));
  if (existsSync(bundled)) return bundled;
  return fileURLToPath(new URL("./child-entry.ts", import.meta.url));
}

/**
 * PATH survives from the parent and HOME is a fresh temp directory.
 * `lineage` is this job's COUNTERSIGN_LINEAGE; it holds no secret.
 */
export function scrubbedEnv(
  parent: Record<string, string | undefined>,
  lineage?: string,
  adapter?: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: parent.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: mkdtempSync(join(tmpdir(), "countersign-runner-")),
  };
  if (lineage !== undefined) env.COUNTERSIGN_LINEAGE = lineage;
  // Only a skill job may answer through the seller's own model account. These three
  // are the only extra variables it sees, and they are never logged. Every other
  // adapter, and a missing one, gets none of them.
  if (adapter === "skill") {
    for (const key of ["SKILL_MODEL_API_KEY", "SKILL_MODEL_BASE_URL", "SKILL_MODEL"]) {
      const value = parent[key];
      if (value !== undefined && value !== "") env[key] = value;
    }
  }
  return env;
}

/** How runInChild starts its child: Bun.spawn under Bun, whose tests observe that call; node:child_process anywhere else. */
export type ChildSpawner = "bun" | "node";

export function defaultSpawner(): ChildSpawner {
  return typeof (globalThis as { Bun?: unknown }).Bun === "undefined" ? "node" : "bun";
}

interface ChildRun {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  oversized: boolean;
}

/** Run one job in the child entry process and return its output. */
export async function runInChild(
  spec: ChildSpec,
  input: unknown,
  limits: ChildLimits,
  lineage?: string,
  spawner: ChildSpawner = defaultSpawner(),
): Promise<unknown> {
  const env = scrubbedEnv(process.env, lineage, spec.adapter);
  const request = JSON.stringify({ spec, input });
  const run =
    spawner === "bun" ? await runWithBun(env, request, limits) : await runWithNode(env, request, limits);

  if (run.timedOut) throw new CeilingError("Refused. The run passed its time ceiling.");
  if (run.oversized) throw new CeilingError("Refused. The output passed its size ceiling.");
  if (run.exitCode !== 0) throw new Error(childError(run.stdout, run.stderr, run.exitCode));

  const parsed = parseJson(run.stdout);
  if (!isRecord(parsed) || !("output" in parsed)) {
    throw new Error("The child returned no output.");
  }
  return parsed.output;
}

async function runWithBun(
  env: Record<string, string>,
  request: string,
  limits: ChildLimits,
): Promise<ChildRun> {
  const proc = Bun.spawn([process.execPath, childEntryPath()], {
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    proc.stdin.write(request);
    await proc.stdin.end();
  } catch {
    // The child can exit before it reads its input; its exit decides the result.
  }

  let timedOut = false;
  let oversized = false;
  let size = 0;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, limits.timeMs);

  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxOutputBytes) {
        oversized = true;
        proc.kill();
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  const stderr = await new Response(proc.stderr).text().catch(() => "");
  const exitCode = await proc.exited;
  return { exitCode, stdout: decode(chunks), stderr, timedOut, oversized };
}

function runWithNode(env: Record<string, string>, request: string, limits: ChildLimits): Promise<ChildRun> {
  return new Promise<ChildRun>((resolve) => {
    const proc = spawn(process.execPath, [childEntryPath()], { env, stdio: ["pipe", "pipe", "pipe"] });
    let timedOut = false;
    let oversized = false;
    let size = 0;
    let settled = false;
    const chunks: Uint8Array[] = [];
    const errorChunks: Uint8Array[] = [];
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, limits.timeMs);
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout: decode(chunks), stderr: decode(errorChunks), timedOut, oversized });
    };
    proc.once("error", () => finish(1));
    proc.once("close", (code) => finish(code ?? 1));
    // The child can exit before it reads its input; its exit decides the result.
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(request);
    proc.stdout.on("data", (chunk: Buffer) => {
      if (oversized) return;
      size += chunk.byteLength;
      if (size > limits.maxOutputBytes) {
        oversized = true;
        proc.kill();
        return;
      }
      chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk);
    });
  });
}

function decode(chunks: Uint8Array[]): string {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function childError(stdout: string, stderr: string, exitCode: number): string {
  const parsed = parseJson(stdout);
  if (isRecord(parsed) && typeof parsed.error === "string") {
    const message = firstLine(parsed.error);
    if (message) return message;
  }
  const message = firstLine(stderr);
  return message || `The child exited with code ${exitCode}.`;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
