/**
 * The Hedera paying agent, run as its operators run it: scripts/hedera/agent-run.ts --json. It reads
 * its own key from the Hedera env file; the suite passes it nothing but a hub URL, a cap, and the
 * offer and input to buy.
 *
 * Since #157 a plain agent run pays held when the hub offers it: a scheduled payment that only the
 * seller's signature executes, about 0.16 HBAR a purchase. The hourly flows pay the exact rail and
 * say so with --exact; the held rail has its own flows, run on demand (21 and 21b).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PaymentRequired, PaymentRequirements } from "@countersign/core";
import { check, equal, type FlowCtx } from "./flow.ts";
import { ROOT } from "./paths.ts";
import { runCmd } from "./procs.ts";

const AGENT = "scripts/hedera/agent-run.ts";

/** Wide enough that the history already on the agent's log never trips a paid call. */
export const OPEN_CAP = "1000000000";

export interface Evidence {
  label: string;
  value: string | number;
  url?: string;
}

export interface AgentRun {
  code: number;
  ok: boolean;
  evidence: Evidence[];
  stderr: string;
}

export interface AgentOptions {
  /** Buy only this listed offer. */
  offer?: string;
  /** The call's input; the agent sends {} without it. */
  input?: unknown;
  /** Pay held, the agent's own default since #157. Without it the agent is told --exact. */
  held?: boolean;
  /** The held failure proof: the call must fail, and the hold must expire unpaid and be released. */
  proveUndelivered?: boolean;
  timeoutMs?: number;
}

/**
 * Whether the branch's agent takes `flag`. The suite runs the agent its branch carries, so a flag can
 * reach the suite before the agent that takes it does; until then the flag is left out.
 */
export function agentTakes(flag: string): boolean {
  const path = join(ROOT, AGENT);
  return existsSync(path) && readFileSync(path, "utf8").includes(`"${flag}"`);
}

/** The 402's exact Hedera accept. A held accept may come first, and it pays another account. */
export function hederaExact(required: PaymentRequired): PaymentRequirements | undefined {
  return required.accepts.find((a) => a.network === "hedera:testnet" && a.scheme === "exact");
}

/** The 402's held Hedera accept (#157): a schedule that the seller's signature executes. */
export function hederaHeld(required: PaymentRequired): PaymentRequirements | undefined {
  return required.accepts.find(
    (a) => a.network === "hedera:testnet" && a.scheme === "countersign" && a.extra?.name === "hedera-scheduled",
  );
}

/** Run the agent once. It pays the exact rail unless `held` or `proveUndelivered` says otherwise. */
export async function agentRun(ctx: FlowCtx, label: string, hub: string, cap: string, opts: AgentOptions = {}): Promise<AgentRun> {
  const cmd = ["bun", AGENT, hub, "--cap", cap, "--per-merchant", cap, "--times", "1", "--json"];
  if (opts.offer) cmd.push("--offer", opts.offer);
  if (opts.input !== undefined) cmd.push("--input", JSON.stringify(opts.input));
  if (opts.proveUndelivered) cmd.push("--prove-undelivered");
  else if (!opts.held && agentTakes("--exact")) cmd.push("--exact");
  const r = await runCmd(
    {
      name: `agent ${label}`,
      cmd,
      log: join(ctx.dir, `agent-${label}.log`),
      redact: (s) => ctx.env.secrets.redact(s),
    },
    opts.timeoutMs ?? 180_000,
  );
  const last = r.stdout.trim().split("\n").at(-1) ?? "";
  let parsed: { beat?: string; ok?: boolean; evidence?: Evidence[] } = {};
  try {
    parsed = JSON.parse(last) as typeof parsed;
  } catch {
    throw new Error(`agent printed no JSON (exit ${r.code}; stderr ${JSON.stringify(r.stderr.trim().slice(-300))})`);
  }
  equal(parsed.beat, "hedera", "agent evidence beat");
  return { code: r.code, ok: parsed.ok === true, evidence: parsed.evidence ?? [], stderr: r.stderr };
}

export function evidence(list: Evidence[], label: string): Evidence {
  const e = list.find((x) => x.label === label);
  check(e, `the agent reports ${label} (it reported ${list.map((x) => x.label).join(", ")})`);
  return e;
}
