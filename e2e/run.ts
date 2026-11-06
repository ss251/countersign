#!/usr/bin/env bun
/**
 * The end-to-end suite.
 *
 *   bun run e2e                          every flow, in matrix order
 *   bun run e2e -- --flow <name> ...     the named flows and the flows they need
 *   bun run e2e -- --list                flows, owners, needs and what each spends
 *   bun run e2e -- --dry                 read balances and plan, spend nothing
 *   bun run e2e -- --public-hub <url>    also check discovery on this public hub
 *   bun run e2e -- --no-public           skip the public hub
 *
 * Exit code 0 when no flow failed, 1 when one did, 2 on bad arguments.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLOWS, NUMBERS } from "./flows/index.ts";
import { formatAmount, planBudget } from "./lib/budget.ts";
import { runFlow, secs, type Flow, type FlowResult, type RunEnv } from "./lib/flow.ts";
import { ARTIFACTS_DIR, repoPath, ROOT } from "./lib/paths.ts";
import { counts, writeRun } from "./lib/report.ts";
import { Secrets } from "./lib/secrets.ts";

const DEFAULT_PUBLIC_HUB = "https://hub-production-e85e.up.railway.app";

interface Args {
  flows: string[];
  list: boolean;
  dry: boolean;
  publicHub?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { flows: [], list: false, dry: false, publicHub: process.env.E2E_PUBLIC_HUB ?? DEFAULT_PUBLIC_HUB };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(`${a} needs a value`);
      return v as string;
    };
    if (a === "--flow") args.flows.push(value());
    else if (a === "--list") args.list = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--public-hub") args.publicHub = value();
    else if (a === "--no-public") delete args.publicHub;
    else usage(`unknown argument ${a}`);
  }
  return args;
}

function usage(problem: string): never {
  console.error(`e2e: ${problem}`);
  console.error("usage: bun run e2e [-- --flow <name> ...] [--list] [--dry] [--public-hub <url> | --no-public]");
  console.error(`flows: ${FLOWS.map((f) => f.name).join(", ")}`);
  process.exit(2);
}

/** The named flows plus everything they need, in matrix order. */
function select(names: string[]): Flow[] {
  if (names.length === 0) return FLOWS;
  const byName = new Map(FLOWS.map((f) => [f.name, f]));
  const wanted = new Set<string>();
  const add = (name: string) => {
    const f = byName.get(name);
    if (!f) usage(`no flow named ${name}`);
    if (wanted.has(name)) return;
    wanted.add(name);
    for (const n of f.needs ?? []) add(n);
  };
  for (const n of names) add(n);
  return FLOWS.filter((f) => wanted.has(f.name));
}

function git(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
  return r.stdout.toString().trim() || "unknown";
}

function newRunId(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const tag = [...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${stamp}-${tag}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const selected = select(args.flows);
  const startedAt = new Date();
  const runId = newRunId(startedAt);
  const dir = join(ARTIFACTS_DIR, runId);
  const secrets = new Secrets();
  const log = (line: string) => console.log(secrets.redact(line));
  const env: RunEnv = {
    runId,
    startedAt,
    dir,
    secrets,
    shared: new Map(),
    options: args.publicHub ? { publicHub: args.publicHub } : {},
    log,
  };

  if (args.list) {
    for (const f of FLOWS) {
      const blocked = f.notRun?.(env);
      let spends = "";
      try {
        spends = (f.spends?.(env) ?? []).map((s) => `${s.wallet.label} ${formatAmount(s.amount, s.wallet.decimals)} ${s.wallet.asset}`).join(", ");
      } catch (e) {
        spends = `(${(e as Error).message})`;
      }
      log(`${(NUMBERS.get(f.name) ?? "").padEnd(3)} ${f.name.padEnd(24)} ${f.owner.padEnd(8)} ${f.network.padEnd(10)} ${f.needs?.length ? `needs ${f.needs.join(",")}  ` : ""}${blocked ? `NOT RUN (${blocked})  ` : ""}${spends}`);
    }
    return;
  }

  mkdirSync(dir, { recursive: true });
  // The run's own outputs do not make it dirty; any other tracked change does.
  const dirty = git("status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)e2e/runs") !== "unknown";
  const commit = `${git("rev-parse", "--short", "HEAD")}${dirty ? " with local changes" : ""}`;
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  log(`e2e run ${runId} · ${branch} ${commit} · ${selected.map((f) => f.name).join(", ")}`);

  const plan = await planBudget(selected, env);
  for (const [id, b] of plan.balances) {
    const w = selected.flatMap((f) => {
      try {
        return f.spends?.(env) ?? [];
      } catch {
        return [];
      }
    }).find((s) => s.wallet.id === id)?.wallet;
    if (!w) continue;
    log(`  balance ${w.label} ${w.asset} ${w.address}: ${typeof b === "bigint" ? formatAmount(b, w.decimals) : `unread (${b.message})`}`);
  }
  for (const r of plan.requests) log(`  budget: ${r}`);
  if (args.dry) {
    for (const f of selected) log(`  ${f.name}: ${f.notRun?.(env) ? `NOT RUN (${f.notRun(env)})` : plan.short.has(f.name) ? "SKIPPED (funds)" : "would run"}`);
    return;
  }

  const results: FlowResult[] = [];
  const byName = new Map<string, FlowResult>();
  for (const flow of selected) {
    log(`[${NUMBERS.get(flow.name) ?? "?"}] ${flow.name} · ${flow.title}`);
    let result: FlowResult;
    const blocked = flow.notRun?.(env);
    const unmet = (flow.needs ?? []).find((n) => byName.get(n)?.status !== "PASS");
    const short = plan.short.get(flow.name);
    if (blocked) result = stub(flow, `NOT RUN (${blocked})`);
    else if (unmet) result = stub(flow, `NOT RUN (needs ${unmet})`);
    else if (short) {
      result = stub(flow, "SKIPPED (funds)");
      for (const s of short) result.notes.push(`${s.wallet.label} ${s.wallet.address} would drop below ${formatAmount(s.floor, s.wallet.decimals)} ${s.wallet.asset}`);
    } else result = await runFlow(flow, env);
    results.push(result);
    byName.set(flow.name, result);
    log(`  ${result.status}${result.status === "PASS" || result.status === "FAIL" ? ` · ${secs(result.ms)}` : ""}${result.failedStep ? ` · step "${result.failedStep}": ${result.error}` : ""}`);
  }

  // Everything written was redacted on the way out; this proves it, files written by the hub included.
  const leaked = leakScan(dir, secrets);
  for (const file of leaked) {
    rmSync(file, { force: true });
    log(`  LEAK  key material found in ${repoPath(file)}; the file was deleted`);
  }

  const c = counts(results);
  const full = args.flows.length === 0;
  const meta = { runId, startedAt, ms: Date.now() - startedAt.getTime(), commit, branch, full, numbers: NUMBERS, budgetRequests: plan.requests };
  const written = writeRun(results, meta);
  writeFileSync(
    join(dir, "run.json"),
    secrets.redact(JSON.stringify({ ...meta, numbers: Object.fromEntries(NUMBERS), counts: c, summary: repoPath(written.path), results }, null, 2)),
  );
  log(`result: ${c.pass} pass · ${c.fail} fail · ${c.skipped} skipped · ${c.notRun} not run · ${secs(meta.ms)}`);
  log(`summary: ${repoPath(written.path)}${written.latest ? ` (and ${repoPath(written.latest)})` : ""}`);
  log(`artifacts: ${repoPath(dir)}/`);
  process.exitCode = c.fail > 0 || leaked.length > 0 ? 1 : 0;
}

function leakScan(dir: string, secrets: Secrets): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (secrets.leaks(readFileSync(path).toString("latin1"))) found.push(path);
    }
  };
  walk(dir);
  return found;
}

function stub(flow: Flow, status: FlowResult["status"]): FlowResult {
  return { name: flow.name, title: flow.title, owner: flow.owner, network: flow.network, status, ms: 0, steps: [], txs: [], notes: [] };
}

await main();
// Child processes are stopped by each flow; nothing should hold the loop, but never hang a scheduled run.
process.exit(process.exitCode ?? 0);
