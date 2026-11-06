/**
 * A flow is a named list of steps. The first failed step ends the flow and names itself;
 * cleanups always run; the run goes on with the next flow.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Wallet } from "./budget.ts";
import { explorerTx, type NetworkKey } from "./chains.ts";
import { httpRecorder, type HttpRecorder } from "./http.ts";
import type { Secrets } from "./secrets.ts";

export type Owner = "orch-cs" | "cs-wc" | "cs-hd" | "cs-ui" | "cs-truth";
export type Status = "PASS" | "FAIL" | "SKIPPED (funds)" | `NOT RUN (${string})`;

export interface TxRef {
  network: NetworkKey;
  label: string;
  tx: string;
  url: string;
  /** Set when the flow expects this transaction to revert. */
  reverted?: boolean;
}

export interface StepResult {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export interface FlowResult {
  name: string;
  title: string;
  owner: Owner;
  network: NetworkKey | "none";
  status: Status;
  ms: number;
  steps: StepResult[];
  failedStep?: string;
  error?: string;
  txs: TxRef[];
  notes: string[];
}

export interface Spend {
  wallet: Wallet;
  /** Most this flow can take from the wallet, atomic units of the wallet's asset. */
  amount: bigint;
  /** The balance the wallet must keep after the flow. */
  floor: bigint;
}

export interface RunEnv {
  runId: string;
  startedAt: Date;
  /** e2e/artifacts/<run-id> */
  dir: string;
  secrets: Secrets;
  /** Outputs one flow leaves for another, e.g. a released slip. */
  shared: Map<string, unknown>;
  /** Options from the command line. */
  options: { publicHub?: string };
  log(line: string): void;
}

export interface Flow {
  name: string;
  title: string;
  owner: Owner;
  network: NetworkKey | "none";
  /** Flows whose outputs this one reads; they run first. */
  needs?: string[];
  timeoutMs?: number;
  /** A reason the flow cannot run here at all, e.g. the browser rule. */
  notRun?(env: RunEnv): string | null;
  /** Set when the flow is too costly to run every hour: full runs skip it, --flow runs it. */
  onDemand?: string;
  /** What the flow may spend, for the budget guard. */
  spends?(env: RunEnv): Spend[];
  run(ctx: FlowCtx): Promise<void>;
}

export interface FlowCtx {
  readonly env: RunEnv;
  /** e2e/artifacts/<run-id>/<flow> */
  readonly dir: string;
  readonly http: HttpRecorder;
  step<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  tx(network: NetworkKey, label: string, tx: string, opts?: { reverted?: boolean }): void;
  note(text: string): void;
  /** Write an artifact (redacted). Returns its path. */
  save(name: string, data: unknown): string;
  /** Runs after the flow, last in first out, even when the flow fails. */
  defer(fn: () => unknown): void;
  share(key: string, value: unknown): void;
  /** An output of a needed flow. Missing means that flow did not pass: this one is NOT RUN. */
  take<T>(key: string, from: string): T;
}

/** A broken expectation. Its message is what the summary shows. */
export class Mismatch extends Error {
  override name = "Mismatch";
}

/** Thrown when a flow cannot run because something it needs is missing. */
export class NotRun extends Error {
  override name = "NotRun";
}

class StepFailure extends Error {
  constructor(
    readonly step: string,
    override readonly cause: unknown,
  ) {
    super(`${step}: ${message(cause)}`);
  }
}

export function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Mismatch(what);
}

export function equal<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) throw new Mismatch(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

/** Hex strings, compared without case. */
export function sameHex(actual: string | null | undefined, expected: string, what: string): void {
  if (typeof actual !== "string" || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Mismatch(`${what}: expected ${expected}, got ${show(actual)}`);
  }
}

export function show(v: unknown): string {
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "string") return JSON.stringify(v.length > 160 ? `${v.slice(0, 160)}…` : v);
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
    return s === undefined ? String(v) : s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch {
    return String(v);
  }
}

export function message(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0] ?? e.name;
  return String(e);
}

export function secs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const DEFAULT_TIMEOUT_MS = 8 * 60_000;

export async function runFlow(flow: Flow, env: RunEnv): Promise<FlowResult> {
  const dir = join(env.dir, flow.name);
  mkdirSync(dir, { recursive: true });
  const result: FlowResult = {
    name: flow.name,
    title: flow.title,
    owner: flow.owner,
    network: flow.network,
    status: "PASS",
    ms: 0,
    steps: [],
    txs: [],
    notes: [],
  };
  const redact = (s: string) => env.secrets.redact(s);
  const cleanups: Array<() => unknown> = [];
  let current = "(before the first step)";

  const ctx: FlowCtx = {
    env,
    dir,
    http: httpRecorder(dir, redact),
    async step(name, fn) {
      current = name;
      const t0 = performance.now();
      try {
        const value = await fn();
        const ms = performance.now() - t0;
        result.steps.push({ name, ok: true, ms });
        env.log(`  ok    ${name} · ${secs(ms)}`);
        return value;
      } catch (e) {
        if (e instanceof NotRun) throw e;
        const ms = performance.now() - t0;
        result.steps.push({ name, ok: false, ms, error: redact(message(e)) });
        env.log(`  FAIL  ${name} · ${secs(ms)} · ${redact(message(e))}`);
        throw new StepFailure(name, e);
      }
    },
    tx(network, label, tx, opts) {
      result.txs.push({ network, label, tx, url: explorerTx(network, tx), ...(opts?.reverted ? { reverted: true } : {}) });
    },
    note(text) {
      result.notes.push(redact(text));
    },
    save(name, data) {
      const path = join(dir, name);
      const body = typeof data === "string" ? data : JSON.stringify(data, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
      writeFileSync(path, redact(body));
      return path;
    },
    defer(fn) {
      cleanups.push(fn);
    },
    share(key, value) {
      env.shared.set(key, value);
    },
    take<T>(key: string, from: string): T {
      if (!env.shared.has(key)) throw new NotRun(`needs ${from}`);
      return env.shared.get(key) as T;
    },
  };

  const limit = flow.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepFailure(current, new Error(`flow timed out after ${secs(limit)}`))), limit);
  });

  const t0 = performance.now();
  try {
    await Promise.race([flow.run(ctx), timeout]);
  } catch (e) {
    if (e instanceof NotRun) {
      result.status = `NOT RUN (${e.message})`;
    } else {
      result.status = "FAIL";
      result.failedStep = e instanceof StepFailure ? e.step : current;
      const cause = e instanceof StepFailure ? e.cause : e;
      result.error = redact(message(cause));
      if (!(e instanceof StepFailure) || e.step === current) {
        // A timeout or a throw outside a step: record the step it was in.
        if (!result.steps.some((s) => s.name === result.failedStep && !s.ok)) {
          result.steps.push({ name: result.failedStep, ok: false, ms: 0, error: result.error });
        }
      }
      ctx.save("error.txt", cause instanceof Error ? `${cause.stack ?? cause.message}` : String(cause));
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    for (const fn of cleanups.reverse()) {
      try {
        await Promise.race([Promise.resolve().then(fn), new Promise((_, r) => setTimeout(() => r(new Error("cleanup timed out")), 20_000))]);
      } catch (e) {
        result.notes.push(redact(`cleanup: ${message(e)}`));
      }
    }
  }
  result.ms = performance.now() - t0;
  writeFileSync(join(dir, "result.json"), redact(JSON.stringify(result, null, 2)));
  return result;
}
