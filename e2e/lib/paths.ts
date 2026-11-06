import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root: every child process runs from here. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The same root with symlinks resolved: the form it takes in a captured stack trace. */
export const REAL_ROOT = realpathSync(ROOT);
export const E2E_DIR = resolve(ROOT, "e2e");
/** Committed: one summary per run, plus LATEST.md. */
export const RUNS_DIR = resolve(E2E_DIR, "runs");
/** Not committed: bodies, logs, slips. */
export const ARTIFACTS_DIR = resolve(E2E_DIR, "artifacts");

/** A path as it should appear in committed text: relative to the repository root. */
export function repoPath(path: string): string {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite this machine's paths in text: the repository root and, in a *-wt checkout, its
 * worktree parent become `$R`, and the home directory becomes `~`. A path only matches when a
 * separator follows it, so ordinary words that start with the same letters are left alone.
 */
export function redactPaths(text: string, root: string = REAL_ROOT, home: string = homedir()): string {
  let out = text.split(`${root}/`).join("$R/");
  const worktreeParent = dirname(root);
  if (basename(worktreeParent).endsWith("-wt")) {
    out = out.replace(new RegExp(`${escapeRegExp(worktreeParent)}/[^/]+/`, "g"), "$R/");
  }
  if (home.length > 1) {
    out = out.replace(new RegExp(`${escapeRegExp(home)}(?=/|$)`, "g"), "~");
  }
  return out;
}
