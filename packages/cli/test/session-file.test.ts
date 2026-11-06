import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSessionBackend, type Session } from "../src/session.ts";

const TOKEN = "session-token-7f3a9c";
const SESSION: Session = {
  token: TOKEN,
  hub: "https://hub.test",
  address: "0x1234567890abcdef1234567890abcdef12345678",
  expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
};

let tmp: string;
let stderr: string[];
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "countersign-session-file-"));
  stderr = [];
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

function worldReadableSession(dir: string): string {
  const backend = fileSessionBackend(dir);
  backend.write(SESSION);
  chmodSync(backend.where(), 0o644);
  return backend.where();
}

describe("the file session backend on a platform without POSIX permission bits", () => {
  test("refuses a 0644 session file on linux", () => {
    const dir = join(tmp, "config");
    const path = worldReadableSession(dir);
    const backend = fileSessionBackend(dir, "linux");

    expect(backend.read()).toBeNull();
    expect(stderr.join("")).toContain(path);
    expect(stderr.join("")).not.toContain(TOKEN);
  });

  test("reads the same 0644 session file on win32", () => {
    const dir = join(tmp, "config");
    worldReadableSession(dir);
    const backend = fileSessionBackend(dir, "win32");

    expect(backend.read()).toEqual(SESSION);
    expect(stderr.join("")).toBe("");
  });

  test("still refuses a symlinked session file on win32", () => {
    const dir = join(tmp, "config");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(tmp, "elsewhere.json");
    writeFileSync(target, `${JSON.stringify(SESSION)}\n`, { mode: 0o600 });
    symlinkSync(target, join(dir, "session.json"));
    const backend = fileSessionBackend(dir, "win32");

    expect(backend.read()).toBeNull();
    expect(stderr.join("")).toContain(backend.where());
    expect(stderr.join("")).not.toContain(TOKEN);
  });
});
