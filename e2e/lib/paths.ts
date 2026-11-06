import { resolve } from "node:path";

/** Repository root: every child process runs from here. */
export const ROOT = resolve(import.meta.dir, "..", "..");
export const E2E_DIR = resolve(ROOT, "e2e");
/** Committed: one summary per run, plus LATEST.md. */
export const RUNS_DIR = resolve(E2E_DIR, "runs");
/** Not committed: bodies, logs, slips. */
export const ARTIFACTS_DIR = resolve(E2E_DIR, "artifacts");

/** A path as it should appear in committed text: relative to the repository root. */
export function repoPath(path: string): string {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}
