/**
 * The Hedera paying agent, run as its operators run it: scripts/hedera/agent-run.ts --json. It reads
 * its own key from the Hedera env file; the suite passes it nothing but a hub URL and a cap.
 */

import { join } from "node:path";
import { check, equal, type FlowCtx } from "./flow.ts";
import { runCmd } from "./procs.ts";

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

export async function agentRun(ctx: FlowCtx, label: string, hub: string, cap: string): Promise<AgentRun> {
  const r = await runCmd(
    {
      name: `agent ${label}`,
      cmd: ["bun", "scripts/hedera/agent-run.ts", hub, "--cap", cap, "--per-merchant", cap, "--times", "1", "--json"],
      log: join(ctx.dir, `agent-${label}.log`),
      redact: (s) => ctx.env.secrets.redact(s),
    },
    180_000,
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
