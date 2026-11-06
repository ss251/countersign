/**
 * Child processes for the suite: hubs, runners, relays and the CLIs a user would run.
 *
 * Each child gets a minimal environment (PATH, HOME and what the caller passes), so a key
 * reaches only the process that needs it. Output is split into lines, redacted, mirrored to a
 * log file under the flow's artifacts and kept in memory for waitFor().
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ROOT } from "./paths.ts";

export interface ProcSpec {
  name: string;
  cmd: string[];
  /** Added to PATH, HOME and NO_COLOR. Keys go here, never in cmd. */
  env?: Record<string, string>;
  cwd?: string;
  /** Log file; created fresh. */
  log: string;
  redact: (text: string) => string;
}

export interface Proc {
  readonly name: string;
  readonly pid: number;
  readonly log: string;
  readonly exited: Promise<number>;
  stdout(): string;
  stderr(): string;
  alive(): boolean;
  /** Resolve with the first match in stdout or stderr; reject on exit or timeout. */
  waitFor(pattern: RegExp, timeoutMs: number): Promise<RegExpExecArray>;
  /** SIGTERM, then SIGKILL after graceMs. Resolves with the exit code. */
  stop(graceMs?: number): Promise<number>;
}

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}

export function spawnProc(spec: ProcSpec): Proc {
  mkdirSync(dirname(spec.log), { recursive: true });
  writeFileSync(spec.log, "");
  const child = Bun.spawn(spec.cmd, {
    cwd: spec.cwd ?? ROOT,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      NO_COLOR: "1",
      ...spec.env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const text = { out: "", err: "" };
  const wakers = new Set<() => void>();
  const wake = () => {
    for (const w of [...wakers]) w();
  };

  const pump = async (stream: ReadableStream<Uint8Array>, which: "out" | "err"): Promise<void> => {
    const decoder = new TextDecoder();
    let partial = "";
    const emit = (chunk: string) => {
      const clean = spec.redact(chunk);
      text[which] += clean;
      appendFileSync(spec.log, which === "err" ? prefixLines(clean, "! ") : clean);
      wake();
    };
    const reader = stream.getReader();
    for (;;) {
      const { value: bytes, done: ended } = await reader.read();
      if (ended) break;
      partial += decoder.decode(bytes, { stream: true });
      const cut = partial.lastIndexOf("\n");
      if (cut < 0) continue;
      emit(partial.slice(0, cut + 1));
      partial = partial.slice(cut + 1);
    }
    partial += decoder.decode();
    if (partial) emit(partial);
  };

  const pumps = Promise.all([pump(child.stdout, "out"), pump(child.stderr, "err")]).catch(() => undefined);
  let done = false;
  const exited = child.exited.then(async (code) => {
    await pumps;
    done = true;
    wake();
    return code;
  });

  const proc: Proc = {
    name: spec.name,
    pid: child.pid,
    log: spec.log,
    exited,
    stdout: () => text.out,
    stderr: () => text.err,
    alive: () => !done,
    waitFor(pattern, timeoutMs) {
      return new Promise<RegExpExecArray>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (fn: () => void) => {
          wakers.delete(check);
          if (timer !== undefined) clearTimeout(timer);
          fn();
        };
        const check = () => {
          const m = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(`${text.out}\n${text.err}`);
          if (m) return finish(() => resolve(m));
          if (done) {
            return finish(() =>
              reject(new Error(`${spec.name} exited before printing ${pattern}; last output: ${tail(text.out + text.err)}`)),
            );
          }
        };
        timer = setTimeout(
          () => finish(() => reject(new Error(`${spec.name} did not print ${pattern} within ${timeoutMs / 1000} s; last output: ${tail(text.out + text.err)}`))),
          timeoutMs,
        );
        wakers.add(check);
        check();
      });
    },
    async stop(graceMs = 5000) {
      if (done) return exited;
      child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (!done) child.kill("SIGKILL");
      }, graceMs);
      const code = await exited;
      clearTimeout(killer);
      return code;
    },
  };
  return proc;
}

/** Run a command to completion. A timeout kills it and reports code -1. */
export async function runCmd(spec: ProcSpec, timeoutMs: number): Promise<CmdResult> {
  const t0 = performance.now();
  const proc = spawnProc(spec);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void proc.stop(2000);
  }, timeoutMs);
  const code = await proc.exited;
  clearTimeout(timer);
  return {
    code: timedOut ? -1 : code,
    stdout: proc.stdout(),
    stderr: proc.stderr() + (timedOut ? `\n[e2e] killed after ${timeoutMs / 1000} s` : ""),
    ms: performance.now() - t0,
  };
}

function prefixLines(text: string, prefix: string): string {
  return text.replace(/^(?=.)/gm, prefix);
}

function tail(text: string, n = 400): string {
  const t = text.trim();
  return JSON.stringify(t.length > n ? `…${t.slice(-n)}` : t);
}
