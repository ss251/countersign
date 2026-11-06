/**
 * The scrubbed child: a job runs in its own process with only PATH and a
 * throwaway HOME, under a time ceiling and an output-size ceiling.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const CHILD_ENTRY = join(import.meta.dir, "child-entry.ts");

/** Only PATH survives from the parent; HOME points at a fresh temp directory. */
export function scrubbedEnv(parent: Record<string, string | undefined>): Record<string, string> {
  return {
    PATH: parent.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: mkdtempSync(join(tmpdir(), "countersign-runner-")),
  };
}

/** Run one job in the child entry process and return its output. */
export async function runInChild(
  spec: ChildSpec,
  input: unknown,
  limits: ChildLimits,
): Promise<unknown> {
  const proc = Bun.spawn([process.execPath, CHILD_ENTRY], {
    env: scrubbedEnv(process.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    proc.stdin.write(JSON.stringify({ spec, input, timeoutMs: limits.timeMs }));
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

  if (timedOut) throw new CeilingError("Refused. The run passed its time ceiling.");
  if (oversized) throw new CeilingError("Refused. The output passed its size ceiling.");
  if (exitCode !== 0) throw new Error(childError(decode(chunks), stderr, exitCode));

  const parsed = parseJson(decode(chunks));
  if (!isRecord(parsed) || !("output" in parsed)) {
    throw new Error("The child returned no output.");
  }
  return parsed.output;
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
