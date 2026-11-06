/**
 * One e2e run at a time on a machine. Two runs would share the suite's gas wallets and race
 * each other for nonces, so a second run waits. A lock whose process is gone is taken over.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sleep } from "./http.ts";

export function lockDir(): string {
  return process.env.E2E_LOCK_DIR ?? join(homedir(), ".countersign", "e2e.lock");
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait for the lock, take it, and return a release function. */
export async function acquireRunLock(label: string, log: (line: string) => void, timeoutMs = 30 * 60_000): Promise<() => void> {
  const dir = lockDir();
  mkdirSync(join(dir, ".."), { recursive: true });
  const until = Date.now() + timeoutMs;
  let told = false;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "owner"), `${process.pid} ${label} ${new Date().toISOString()}\n`);
      return () => rmSync(dir, { recursive: true, force: true });
    } catch {
      const owner = existsSync(join(dir, "owner")) ? readFileSync(join(dir, "owner"), "utf8").trim() : "";
      const pid = Number(owner.split(" ")[0]);
      if (!Number.isSafeInteger(pid) || pid <= 0 || !alive(pid)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (!told) {
        log(`waiting for the e2e run lock (held by ${owner})`);
        told = true;
      }
      if (Date.now() > until) throw new Error(`the e2e run lock is still held after ${timeoutMs / 60_000} min (${owner})`);
      await sleep(5000);
    }
  }
}
