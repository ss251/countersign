import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

export interface Session { token: string; hub: string; address: string; expiresAt: number }

export interface SessionBackend {
  readonly kind: "keychain" | "file";
  where(): string;
  read(): Session | null;
  write(session: Session): void;
  clear(): void;
}

export type SecurityRun = (args: string[], input?: string) => string;
const securityRun: SecurityRun = (args, input) =>
  execFileSync("/usr/bin/security", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

function parse(text: string): Session | null {
  try {
    const value = JSON.parse(text) as Partial<Session>;
    if (typeof value.token === "string" && typeof value.hub === "string" && typeof value.address === "string" && typeof value.expiresAt === "number") {
      return value as Session;
    }
  } catch {}
  return null;
}

function refuse(path: string): null {
  process.stderr.write(`countersign: refusing the session at ${path}: symlink, non-regular file or unsafe permissions.\n`);
  return null;
}

export function fileSessionBackend(dir: string = join(homedir(), ".config", "countersign")): SessionBackend {
  const path = join(dir, "session.json");
  return {
    kind: "file",
    where: () => path,
    read() {
      try {
        if (lstatSync(dir).isSymbolicLink()) return refuse(dir);
      } catch {
        return null;
      }
      try {
        const info = lstatSync(path);
        if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) return refuse(path);
      } catch {
        return null;
      }
      try {
        return parse(readFileSync(path, "utf8"));
      } catch {
        return null;
      }
    },
    write(session) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const tmp = `${path}.tmp`;
      rmSync(tmp, { force: true });
      const fd = openSync(tmp, "wx", 0o600);
      try {
        writeSync(fd, `${JSON.stringify(session)}\n`);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path);
    },
    clear() {
      rmSync(path, { force: true });
    },
  };
}

/** macOS login Keychain, service countersign, account session. The value goes in through stdin, hex-encoded, never argv. */
export function keychainSessionBackend(run: SecurityRun = securityRun): SessionBackend {
  return {
    kind: "keychain",
    where: () => "the macOS login Keychain (service countersign, account session)",
    read() {
      try {
        const hex = run(["find-generic-password", "-s", "countersign", "-a", "session", "-w"]).trim();
        return hex === "" ? null : parse(Buffer.from(hex, "hex").toString("utf8"));
      } catch {
        return null;
      }
    },
    write(session) {
      const hex = Buffer.from(JSON.stringify(session), "utf8").toString("hex");
      run(["-i"], `add-generic-password -U -s countersign -a session -w ${hex}\n`);
    },
    clear() {
      try {
        run(["delete-generic-password", "-s", "countersign", "-a", "session"]);
      } catch {}
    },
  };
}

/** Keychain on macOS, the 0600 file elsewhere. COUNTERSIGN_KEYSTORE=file forces the file. */
export function defaultSessionBackend(env: Record<string, string | undefined> = process.env): SessionBackend {
  if (env.COUNTERSIGN_KEYSTORE === "file") return fileSessionBackend();
  if (process.platform === "darwin" && existsSync("/usr/bin/security")) return keychainSessionBackend();
  return fileSessionBackend();
}

/** The stored session, if it has not expired. */
export function loadSession(backend: SessionBackend = defaultSessionBackend(), now = Math.floor(Date.now() / 1000)): Session | null {
  const session = backend.read();
  return session !== null && session.expiresAt > now ? session : null;
}
