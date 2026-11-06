/**
 * The run summary: e2e/runs/<run-id>.md, committed. A full run also becomes LATEST.md.
 * Committed text carries no keys and no machine paths: addresses, hashes and links only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowResult } from "./flow.ts";
import { secs } from "./flow.ts";
import { RUNS_DIR } from "./paths.ts";

export interface RunMeta {
  runId: string;
  startedAt: Date;
  ms: number;
  commit: string;
  branch: string;
  /** The Arc escrow version this run exercised. */
  escrowVersion: 1 | 2;
  /** The Arc escrow address the run read and settled through. */
  escrow: string;
  /** True when every flow was selected. */
  full: boolean;
  /** Flow numbers in the coverage matrix, by name. */
  numbers: Map<string, string>;
  budgetRequests: string[];
}

export interface Counts {
  pass: number;
  fail: number;
  skipped: number;
  notRun: number;
}

export function counts(results: FlowResult[]): Counts {
  return {
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    skipped: results.filter((r) => r.status === "SKIPPED (funds)").length,
    notRun: results.filter((r) => r.status.startsWith("NOT RUN")).length,
  };
}

export function renderRun(results: FlowResult[], meta: RunMeta): string {
  const c = counts(results);
  const ist = new Date(meta.startedAt.getTime() + 5.5 * 3600_000).toISOString().slice(11, 16);
  const lines: string[] = [];
  lines.push(`# e2e run ${meta.runId}`, "");
  lines.push("| | |", "|---|---|");
  lines.push(`| commit | \`${meta.commit}\` on \`${meta.branch}\` |`);
  lines.push(`| escrow | v${meta.escrowVersion} · \`${meta.escrow}\` |`);
  lines.push(`| started | ${meta.startedAt.toISOString().replace("T", " ").slice(0, 19)} UTC (${ist} IST) |`);
  lines.push(`| duration | ${secs(meta.ms)} |`);
  lines.push(`| scope | ${meta.full ? "full run, every flow" : `selected: ${results.map((r) => `\`${r.name}\``).join(", ")}`} |`);
  lines.push(`| result | ${c.pass} pass · ${c.fail} fail · ${c.skipped} skipped · ${c.notRun} not run |`);
  lines.push("");

  lines.push("| # | Flow | Status | Time | Failed step |", "|---|---|---|---|---|");
  for (const r of results) {
    const time = r.status === "PASS" || r.status === "FAIL" ? secs(r.ms) : "";
    lines.push(`| ${meta.numbers.get(r.name) ?? ""} | \`${r.name}\` | ${r.status} | ${time} | ${r.failedStep ? `\`${r.failedStep}\`` : ""} |`);
  }
  lines.push("");

  const withTxs = results.filter((r) => r.txs.length > 0);
  if (withTxs.length > 0) {
    lines.push("## Transactions", "");
    for (const r of withTxs) {
      lines.push(`**${r.name}**`, "");
      for (const t of r.txs) {
        lines.push(`- ${t.label}${t.reverted ? " (reverted, as expected)" : ""}: [\`${short(t.tx)}\`](${t.url})`);
      }
      lines.push("");
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  if (failed.length > 0) {
    lines.push("## Failures", "");
    for (const r of failed) {
      lines.push(`**${r.name}** · step \`${r.failedStep ?? "?"}\` · owner ${r.owner}`, "");
      lines.push(`> ${(r.error ?? "").replace(/\n/g, " ").slice(0, 600)}`, "");
    }
  }

  const noted = results.filter((r) => r.notes.length > 0 || r.status.startsWith("SKIPPED"));
  if (noted.length > 0) {
    lines.push("## Notes", "");
    for (const r of noted) for (const n of r.notes) lines.push(`- \`${r.name}\`: ${n}`);
    for (const req of meta.budgetRequests) lines.push(`- budget: ${req.replace(/\|/g, "·")}`);
    lines.push("");
  }

  lines.push("## Steps", "");
  for (const r of results) {
    if (r.steps.length === 0) continue;
    lines.push(`**${r.name}**`, "");
    for (const s of r.steps) lines.push(`- ${s.ok ? "ok" : "FAIL"} · ${s.name} · ${secs(s.ms)}${s.error ? ` · ${s.error.slice(0, 300)}` : ""}`);
    lines.push("");
  }

  lines.push(`Artifacts for this run (bodies, logs, slips) stay on the build machine under \`e2e/artifacts/${meta.runId}/\`.`, "");
  return lines.join("\n");
}

export function writeRun(results: FlowResult[], meta: RunMeta): { path: string; latest?: string } {
  const text = renderRun(results, meta);
  // Full runs are committed; a run of selected flows is kept beside them but not committed.
  const dir = meta.full ? RUNS_DIR : join(RUNS_DIR, "partial");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${meta.runId}.md`);
  writeFileSync(path, text);
  if (!meta.full) return { path };
  const latest = join(RUNS_DIR, "LATEST.md");
  writeFileSync(latest, `<!-- the latest full run; its own file is ${meta.runId}.md -->\n${text}`);
  return { path, latest };
}

function short(tx: string): string {
  return tx.length > 20 ? `${tx.slice(0, 10)}…${tx.slice(-6)}` : tx;
}
