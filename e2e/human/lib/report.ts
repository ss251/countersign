/**
 * The human run's own report: e2e/human/runs/<run-id>.md and LATEST.md.
 *
 * The reporter runs in Playwright's main process; the tests run in workers, so each test writes
 * its state beside its artifacts and the reporter reads it in onEnd. Every value written passes
 * the leak scan first.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { explorerTx } from "../../lib/chains.ts";
import { redactPaths } from "../../lib/paths.ts";
import type { Secrets } from "../../lib/secrets.ts";
import { Keyring, SECRET_NAMES } from "./keys.ts";

export const HUMAN_DIR = fileURLToPath(new URL("..", import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const ARTIFACTS_DIR = join(HUMAN_DIR, "artifacts");
export const RUNS_DIR = join(HUMAN_DIR, "runs");
export const TEST_RESULTS_DIR = join(HUMAN_DIR, "test-results");

export const DEFAULT_CONSOLE = "https://counter-sign.up.railway.app";
export const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";

export function consoleUrl(): string {
  return process.env.E2E_HUMAN_CONSOLE || DEFAULT_CONSOLE;
}

export function hubUrl(): string {
  return process.env.E2E_HUMAN_HUB || DEFAULT_HUB;
}

export type ProjectStatus = "PASS" | "FAIL" | "NOT RUN";
export type StepStatus = "ok" | "fail" | "skip";

export interface StepResult {
  name: string;
  status: StepStatus;
  ms: number;
  error?: string;
}

export interface TxRef {
  label: string;
  hash: string;
}

export interface ProjectRun {
  project: string;
  status: ProjectStatus;
  skipReason?: string;
  failedStep?: string;
  error?: string;
  wallet?: string;
  steps: StepResult[];
  txs: TxRef[];
  notes?: string[];
  slip?: string;
  verifier?: string;
  ms?: number;
  artifacts: string[];
}

export interface RunMeta {
  runId: string;
  commit: string;
  consoleUrl: string;
  hubUrl: string;
  startedAt: string;
  ms: number;
}

const RUN_ID_FILE = join(ARTIFACTS_DIR, ".run-id");
const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export function createRunId(at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function writeRunId(runId: string, artifactsDir: string = ARTIFACTS_DIR): void {
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, ".run-id"), `${runId}\n`);
}

/** The reporter writes this before the workers start; a test without one makes its own. */
export function currentRunId(): string {
  try {
    const value = readFileSync(RUN_ID_FILE, "utf8").trim();
    if (RUN_ID_PATTERN.test(value)) return value;
  } catch {
    // no reporter has run yet
  }
  const runId = createRunId();
  writeRunId(runId);
  return runId;
}

export function statePath(runId: string, project: string, artifactsDir: string = ARTIFACTS_DIR): string {
  return join(artifactsDir, runId, project, "result.json");
}

export function writeProjectState(project: ProjectRun, runId: string, artifactsDir: string = ARTIFACTS_DIR): void {
  const file = statePath(runId, project.project, artifactsDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, redactPaths(JSON.stringify(project, null, 2)));
}

export function readProjectStates(runId: string, artifactsDir: string = ARTIFACTS_DIR): ProjectRun[] {
  const dir = join(artifactsDir, runId);
  const names: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.push(entry.name);
    }
  } catch {
    return [];
  }
  const order = ["privy", "injected"];
  names.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });
  const out: ProjectRun[] = [];
  for (const name of names) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, name, "result.json"), "utf8")) as ProjectRun);
    } catch {
      // a project that never wrote a state file did not run
    }
  }
  return out;
}

/** Records one project's steps, transactions and artifact paths, and writes its state file. */
export class Recorder {
  readonly steps: StepResult[] = [];
  readonly txs: TxRef[] = [];
  readonly notes: string[] = [];
  readonly artifacts: string[] = [];
  wallet?: string;
  slip?: string;
  verifier?: string;
  private readonly startedAt = Date.now();
  private guard?: { leaks(text: string): boolean };

  constructor(
    readonly runId: string,
    readonly project: string,
    readonly artifactsDir: string = ARTIFACTS_DIR,
  ) {}

  dir(): string {
    return join(this.artifactsDir, this.runId, this.project);
  }

  file(name: string): string {
    return join(this.dir(), name);
  }

  addArtifact(file: string): void {
    this.artifacts.push(relative(HUMAN_DIR, file).split(sep).join("/"));
  }

  guardWith(guard: { leaks(text: string): boolean }): void {
    this.guard = guard;
  }

  async screenshot(
    page: Page,
    nn: string,
    slug: string,
    options?: { showPrivy?: boolean },
  ): Promise<void> {
    const file = this.file(`${nn}-${slug}.png`);
    if (this.guard) {
      const text = await page.locator("body").innerText().catch(() => "");
      if (this.guard.leaks(text)) {
        this.note(`${nn}-${slug}: screenshot withheld, the page showed a secret`);
        return;
      }
    }
    mkdirSync(this.dir(), { recursive: true });
    const mask = options?.showPrivy ? [] : [page.locator("#privy-modal-content")];
    await page.screenshot({ path: file, mask });
    this.addArtifact(file);
  }

  record(name: string, status: StepStatus, ms: number, error?: string): void {
    this.steps.push({ name, status, ms, ...(error ? { error: error.replace(/\s+/g, " ").slice(0, 600) } : {}) });
  }

  tx(label: string, hash: string): void {
    this.txs.push({ label, hash });
  }

  note(text: string): void {
    this.notes.push(text.replace(/\s+/g, " ").slice(0, 600));
  }

  get failedStep(): string | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const step = this.steps[i];
      if (step?.status === "fail") return step.name;
    }
    return undefined;
  }

  write(status: ProjectStatus, extra: { skipReason?: string; error?: string } = {}): ProjectRun {
    const state: ProjectRun = {
      project: this.project,
      status,
      steps: this.steps,
      txs: this.txs,
      notes: this.notes,
      artifacts: this.artifacts,
      ms: Date.now() - this.startedAt,
      ...(extra.skipReason ? { skipReason: extra.skipReason } : {}),
      ...(status === "FAIL" && this.failedStep ? { failedStep: this.failedStep } : {}),
      ...(extra.error ? { error: extra.error.replace(/\s+/g, " ").slice(0, 600) } : {}),
      ...(this.wallet ? { wallet: this.wallet } : {}),
      ...(this.slip ? { slip: this.slip } : {}),
      ...(this.verifier ? { verifier: this.verifier } : {}),
    };
    writeProjectState(state, this.runId, this.artifactsDir);
    return state;
  }
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function secs(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function stepStatus(status: StepStatus): string {
  if (status === "ok") return "ok";
  if (status === "skip") return "not run";
  return "FAIL";
}

export function renderReport(meta: RunMeta, projects: ProjectRun[]): string {
  const lines: string[] = [];
  lines.push(`# human e2e run ${meta.runId}`, "");
  lines.push("| | |", "|---|---|");
  lines.push(`| run | \`${meta.runId}\` |`);
  lines.push(`| commit | \`${meta.commit}\` |`);
  lines.push(`| console | ${meta.consoleUrl} |`);
  lines.push(`| hub | ${meta.hubUrl} |`);
  lines.push(`| started | ${meta.startedAt.replace("T", " ").slice(0, 19)} UTC |`);
  lines.push(`| duration | ${secs(meta.ms)} |`);
  lines.push("");

  if (projects.length === 0) {
    lines.push("No project ran.", "");
    return lines.join("\n");
  }

  for (const project of projects) {
    const heading =
      project.status === "NOT RUN"
        ? `## ${project.project} — NOT RUN (${project.skipReason ?? "skipped"})`
        : `## ${project.project} — ${project.status}`;
    lines.push(heading, "");
    if (project.wallet) lines.push(`wallet: \`${project.wallet}\``, "");
    if (project.status === "FAIL") {
      lines.push(`failed step: \`${project.failedStep ?? "?"}\``, "");
      if (project.error) lines.push(`> ${cell(project.error)}`, "");
    }
    if (project.steps.length > 0) {
      lines.push("| step | status | duration |", "|---|---|---|");
      for (const step of project.steps) {
        lines.push(`| \`${cell(step.name)}\` | ${stepStatus(step.status)} | ${secs(step.ms)} |`);
      }
      lines.push("");
    }
    if (project.notes && project.notes.length > 0) {
      lines.push("Notes", "");
      for (const note of project.notes) lines.push(`- ${cell(note)}`);
      lines.push("");
    }
    if (project.txs.length > 0) {
      lines.push("Transactions", "");
      for (const tx of project.txs) {
        lines.push(`- ${tx.label}: [\`${tx.hash}\`](${explorerTx("arc", tx.hash)})`);
      }
      lines.push("");
    }
    if (project.slip) lines.push(`slip: \`${project.slip}\``, "");
    if (project.verifier) lines.push(`verifier: ${project.verifier}`, "");
    if (project.artifacts.length > 0) {
      lines.push("Artifacts", "");
      for (const artifact of project.artifacts) lines.push(`- \`${artifact}\``);
      lines.push("");
    }
  }
  return lines.join("\n");
}

const TEXT_FILE = /\.(json|md|txt|log|csv|html?|xml|ya?ml|ts|js)$/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** Every text file under `dir` that holds a registered secret. Deletes nothing. */
export function leakScan(dir: string, secrets: Secrets): string[] {
  const out: string[] = [];
  for (const file of walk(dir)) {
    if (!TEXT_FILE.test(file)) continue;
    try {
      if (secrets.leaks(readFileSync(file, "utf8"))) out.push(file);
    } catch {
      // unreadable files cannot leak text
    }
  }
  return out;
}

export interface FinalizeOptions {
  meta: RunMeta;
  projects: ProjectRun[];
  secrets: Secrets;
  artifactsDir?: string;
  runsDir?: string;
  testResultsDir?: string;
}

export interface FinalizeResult {
  path: string;
  latest: string;
  leaks: string[];
  exitCode: number;
  text: string;
}

export function finalizeReport(options: FinalizeOptions): FinalizeResult {
  const artifactsDir = options.artifactsDir ?? ARTIFACTS_DIR;
  const runsDir = options.runsDir ?? RUNS_DIR;
  const testResultsDir = options.testResultsDir ?? TEST_RESULTS_DIR;
  const runDir = join(artifactsDir, options.meta.runId);
  const leaked = existsSync(runDir) ? leakScan(runDir, options.secrets) : [];
  const leakingResults = existsSync(testResultsDir) ? leakScan(testResultsDir, options.secrets) : [];
  const leaks = [...leaked, ...leakingResults];
  for (const file of leaks) rmSync(file, { force: true });

  const projects = options.projects.map((project) => {
    let artifacts = project.artifacts;
    for (const file of leaked) {
      const rel = relative(runDir, file).split(sep).join("/");
      if (!rel.startsWith(`${project.project}/`)) continue;
      artifacts = artifacts.filter((artifact) => !artifact.endsWith(rel));
    }
    return { ...project, artifacts };
  });

  const text = redactPaths(options.secrets.redact(renderReport(options.meta, projects)));
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, `${options.meta.runId}.md`);
  writeFileSync(path, text);
  const latest = join(runsDir, "LATEST.md");
  writeFileSync(latest, `<!-- the latest human acceptance run; its own file is ${options.meta.runId}.md -->\n${text}`);

  for (const file of leaks) {
    const shown = file.startsWith(`${REPO_ROOT}/`) ? relative(REPO_ROOT, file) : file;
    console.error(`leak: ${shown}`);
  }
  return { path, latest, leaks, exitCode: leaks.length > 0 ? 1 : 0, text };
}

export function gitInfo(): { commit: string; dirty: boolean } {
  const commitRun = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const commit = commitRun.status === 0 ? commitRun.stdout.trim() || "unknown" : "unknown";
  const statusRun = spawnSync("git", ["status", "--porcelain", "--", ".", ":(exclude)e2e/human/runs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const dirty = statusRun.status === 0 && statusRun.stdout.trim() !== "";
  return { commit: dirty ? `${commit} with local changes` : commit, dirty };
}

export interface RunFinalizeOptions {
  artifactsDir?: string;
  runsDir?: string;
  secrets?: Secrets;
}

/** Finalize one run from its per-project states; a run with no states is still scanned. */
export function finalizeRun(
  runId: string,
  startedAt: Date,
  options: RunFinalizeOptions = {},
): FinalizeResult {
  const artifactsDir = options.artifactsDir ?? ARTIFACTS_DIR;
  const runsDir = options.runsDir ?? RUNS_DIR;
  const projects = readProjectStates(runId, artifactsDir);
  let secrets = options.secrets;
  if (!secrets) {
    const keys = new Keyring();
    for (const name of SECRET_NAMES) keys.secret(name);
    secrets = keys.secrets;
  }
  const meta: RunMeta = {
    runId,
    commit: gitInfo().commit,
    consoleUrl: consoleUrl(),
    hubUrl: hubUrl(),
    startedAt: startedAt.toISOString(),
    ms: Date.now() - startedAt.getTime(),
  };
  return finalizeReport({ meta, projects, secrets, artifactsDir, runsDir });
}

export interface HumanReporterOptions {
  artifactsDir?: string;
  runsDir?: string;
  secrets?: Secrets;
}

export class HumanReporter {
  private runId = "";
  private startedAt = new Date();
  private began = false;
  private readonly artifactsDir: string;
  private readonly runsDir: string;
  private readonly secrets?: Secrets;

  constructor(options: HumanReporterOptions = {}) {
    this.artifactsDir = options.artifactsDir ?? ARTIFACTS_DIR;
    this.runsDir = options.runsDir ?? RUNS_DIR;
    this.secrets = options.secrets;
  }

  onBegin(): void {
    this.began = false;
    this.runId = createRunId();
    this.startedAt = new Date();
    writeRunId(this.runId, this.artifactsDir);
    mkdirSync(join(this.artifactsDir, this.runId), { recursive: true });
  }

  onTestBegin(): void {
    this.began = true;
  }

  onEnd(): void {
    if (!this.began) return;
    const runId = this.runId || currentRunId();
    const result = finalizeRun(runId, this.startedAt, {
      artifactsDir: this.artifactsDir,
      runsDir: this.runsDir,
      ...(this.secrets ? { secrets: this.secrets } : {}),
    });
    console.log(`human report: ${result.path}${result.latest ? ` and ${result.latest}` : ""}`);
    if (result.exitCode !== 0) process.exit(1);
  }
}

export default HumanReporter;
