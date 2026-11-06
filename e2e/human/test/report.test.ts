import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REAL_ROOT } from "../../lib/paths.ts";
import { Secrets } from "../../lib/secrets.ts";
import {
  finalizeReport,
  finalizeRun,
  HumanReporter,
  renderReport,
  REPO_ROOT,
  statePath,
  writeProjectState,
  type ProjectRun,
  type RunMeta,
} from "../lib/report.ts";

const dirs: string[] = [];
const RUN_ID = "20260101-000000-abcd";
const TX = `0x${"33".repeat(32)}`;
const SLIP = `0x${"44".repeat(32)}`;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cs-human-report-"));
  dirs.push(dir);
  return dir;
}

function meta(): RunMeta {
  return {
    runId: RUN_ID,
    commit: "abc1234",
    consoleUrl: "https://console.test",
    hubUrl: "https://hub.test",
    startedAt: "2026-01-01T00:00:00.000Z",
    ms: 123_000,
  };
}

function project(overrides: Partial<ProjectRun>): ProjectRun {
  return {
    project: "privy",
    status: "PASS",
    steps: [{ name: "00-open", status: "ok", ms: 900 }],
    txs: [],
    artifacts: [],
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the run report", () => {
  test("renders PASS, FAIL and NOT RUN with explorer links", () => {
    const text = renderReport(meta(), [
      project({}),
      project({
        project: "injected",
        status: "FAIL",
        failedStep: "05-buy",
        error: "the console refused the purchase",
        wallet: "0x1111111111111111111111111111111111111111",
        steps: [
          { name: "00-open", status: "ok", ms: 800 },
          { name: "05-buy", status: "fail", ms: 1_200, error: "refused" },
        ],
        txs: [
          { label: "funding", hash: TX },
          { label: "escrow fund", hash: TX },
          { label: "release", hash: TX },
        ],
        slip: SLIP,
        verifier: "VALID",
        artifacts: ["artifacts/x/injected/00-open.png"],
      }),
      project({ project: "other", status: "NOT RUN", skipReason: "no Privy test login" }),
    ]);

    expect(text).toContain("## privy — PASS");
    expect(text).toContain("## injected — FAIL");
    expect(text).toContain("failed step: `05-buy`");
    expect(text).toContain("## other — NOT RUN (no Privy test login)");
    expect(text).toContain(`https://explorer.testnet.arc.io/tx/${TX}`);
    expect(text).toContain(`slip: \`${SLIP}\``);
    expect(text).toContain("verifier: VALID");
  });

  test("writes the run and LATEST, and deletes a leaked artifact", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const runsDir = join(root, "runs");
    const secret = `0x${"ef".repeat(32)}`;
    const planted = join(artifactsDir, RUN_ID, "privy", "planted.json");
    mkdirSync(join(artifactsDir, RUN_ID, "privy"), { recursive: true });
    writeFileSync(planted, JSON.stringify({ note: `the funder key is ${secret}` }));

    const result = finalizeReport({
      meta: meta(),
      projects: [project({ artifacts: [`artifacts/${RUN_ID}/privy/planted.json`] })],
      secrets: Secrets.fromEntries({ E2E_HUMAN_FUNDER_KEY: secret }),
      artifactsDir,
      runsDir,
    });

    expect(result.exitCode).toBe(1);
    expect(result.leaks).toEqual([planted]);
    expect(existsSync(planted)).toBe(false);
    expect(result.text).not.toContain(secret);
    const written = readFileSync(join(runsDir, `${RUN_ID}.md`), "utf8");
    expect(written).not.toContain(secret);
    expect(written).not.toContain("planted.json");
    expect(readFileSync(join(runsDir, "LATEST.md"), "utf8").split("\n")[0]).toContain(`${RUN_ID}.md`);
  });

  test("the report and LATEST rewrite the repository and home paths", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const runsDir = join(root, "runs");
    const error = `boom at ${REAL_ROOT}/e2e/human/lib/report.ts:85 and ${homedir()}/.config/countersign/e2e.env`;
    const result = finalizeReport({
      meta: meta(),
      projects: [project({ status: "FAIL", failedStep: "05-buy", error })],
      secrets: Secrets.fromEntries({}),
      artifactsDir,
      runsDir,
    });

    expect(result.text).toContain("$R/e2e/human/lib/report.ts:85");
    expect(result.text).toContain("~/.config/countersign/e2e.env");
    expect(result.text).not.toContain(REAL_ROOT);
    for (const file of [join(runsDir, `${RUN_ID}.md`), join(runsDir, "LATEST.md")]) {
      const written = readFileSync(file, "utf8");
      expect(written).toContain("$R/e2e/human/lib/report.ts:85");
      expect(written).toContain("~/.config/countersign/e2e.env");
      expect(written).not.toContain(REAL_ROOT);
    }
  });

  test("a state file rewrites local paths before it is written", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const state = project({ status: "FAIL", failedStep: "05-buy", error: `boom at ${REAL_ROOT}/e2e/human/lib/report.ts:85` });
    writeProjectState(state, RUN_ID, artifactsDir);

    const written = readFileSync(statePath(RUN_ID, state.project, artifactsDir), "utf8");
    expect(written).toContain("$R/e2e/human/lib/report.ts:85");
    expect(written).not.toContain(REAL_ROOT);
  });

  test("the leak scan runs when no result.json exists and still deletes a planted file", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const runsDir = join(root, "runs");
    const secret = `0x${"ef".repeat(32)}`;
    const planted = join(artifactsDir, RUN_ID, "privy", "planted.json");
    mkdirSync(join(artifactsDir, RUN_ID, "privy"), { recursive: true });
    writeFileSync(planted, JSON.stringify({ note: `the funder key is ${secret}` }));

    const result = finalizeRun(RUN_ID, new Date("2026-01-01T00:00:00.000Z"), {
      artifactsDir,
      runsDir,
      secrets: Secrets.fromEntries({ E2E_HUMAN_FUNDER_KEY: secret }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.leaks).toEqual([planted]);
    expect(existsSync(planted)).toBe(false);
    expect(result.text).toContain("No project ran.");
    expect(result.text).not.toContain(secret);
  });

  test("a clean run exits zero and keeps its artifacts", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const runsDir = join(root, "runs");
    const shot = join(artifactsDir, RUN_ID, "privy", "00-open.png");
    mkdirSync(join(artifactsDir, RUN_ID, "privy"), { recursive: true });
    writeFileSync(shot, "not really a png");

    const result = finalizeReport({
      meta: meta(),
      projects: [project({ artifacts: [`artifacts/${RUN_ID}/privy/00-open.png`] })],
      secrets: Secrets.fromEntries({ E2E_HUMAN_FUNDER_KEY: `0x${"ef".repeat(32)}` }),
      artifactsDir,
      runsDir,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(shot)).toBe(true);
    expect(result.text).toContain("00-open.png");
  });

  test("the leak path exits non-zero in a fresh process", () => {
    const root = tempDir();
    const fixture = join(REPO_ROOT, "e2e/human/test/fixtures/leak-run.ts");
    const run = spawnSync(process.execPath, [fixture, root], { encoding: "utf8", timeout: 60_000 });
    expect(run.status).toBe(1);
    expect(`${run.stderr}`).toContain("leak: ");
  });

  test("a listing writes no report when no test begins", () => {
    const root = tempDir();
    const artifactsDir = join(root, "artifacts");
    const runsDir = join(root, "runs");
    const reporter = new HumanReporter({
      artifactsDir,
      runsDir,
      secrets: Secrets.fromEntries({}),
    });

    reporter.onBegin();
    reporter.onEnd();

    expect(existsSync(runsDir)).toBe(false);
  });
});
