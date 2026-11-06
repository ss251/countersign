/**
 * Runs one finalizeReport with a planted secret so the offline test can see the process code.
 * Not a test: the *.test.ts file spawns this and checks its exit status.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Secrets } from "../../../lib/secrets.ts";
import { finalizeReport, type ProjectRun, type RunMeta } from "../../lib/report.ts";

const root = process.argv[2];
if (!root) {
  console.error("usage: leak-run <dir>");
  process.exit(2);
}

const runId = "20260101-000000-abcd";
const secret = `0x${"ef".repeat(32)}`;
const artifactsDir = join(root, "artifacts");
const runsDir = join(root, "runs");
const planted = join(artifactsDir, runId, "privy", "planted.json");
mkdirSync(join(artifactsDir, runId, "privy"), { recursive: true });
writeFileSync(planted, JSON.stringify({ leaked: secret }));

const meta: RunMeta = {
  runId,
  commit: "abc1234",
  consoleUrl: "https://console.test",
  hubUrl: "https://hub.test",
  startedAt: "2026-01-01T00:00:00.000Z",
  ms: 1_000,
};
const project: ProjectRun = {
  project: "privy",
  status: "PASS",
  steps: [],
  txs: [],
  artifacts: [`artifacts/${runId}/privy/planted.json`],
};

const result = finalizeReport({
  meta,
  projects: [project],
  secrets: Secrets.fromEntries({ E2E_HUMAN_FUNDER_KEY: secret }),
  artifactsDir,
  runsDir,
});
process.exit(result.exitCode);
