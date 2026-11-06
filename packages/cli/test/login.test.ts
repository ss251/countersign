import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMAND_USAGE,
  DEFAULT_HUB,
  VERSION,
  run,
  useSession,
  withHub,
  type CliDeps,
} from "../src/cli.ts";
import { runLogin, runLogout, runWhoami } from "../src/login.ts";
import {
  NOT_SIGNED_IN,
  fileSessionBackend,
  keychainSessionBackend,
  loadSession,
  type SecurityRun,
  type Session,
} from "../src/session.ts";

const TOKEN = "session-token-7f3a9c";
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const HUB = "https://hub.test";
const NOW = 1_700_000_000;
const FRESH = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
const SESSION: Session = { token: TOKEN, hub: HUB, address: ADDRESS, expiresAt: FRESH };

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchRecorder(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function inertDeps(calls: string[]): CliDeps {
  return {
    runner: async () => {
      calls.push("runner");
    },
    loadBuyer: async () => {
      calls.push("buyer");
    },
    loadVerify: async () => {
      calls.push("verify");
    },
    loadMcp: async () => {
      calls.push("mcp");
    },
  };
}

let tmp: string;
let savedHome: string | undefined;
let savedKeystore: string | undefined;
let stdout: string[];
let stderr: string[];
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "countersign-login-"));
  savedHome = process.env.HOME;
  savedKeystore = process.env.COUNTERSIGN_KEYSTORE;
  stdout = [];
  stderr = [];
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedKeystore === undefined) delete process.env.COUNTERSIGN_KEYSTORE;
  else process.env.COUNTERSIGN_KEYSTORE = savedKeystore;
  process.exitCode = 0;
});

describe("session storage", () => {
  test("the file backend round-trips with mode 0600 in a 0700 directory", () => {
    const dir = join(tmp, "config");
    const backend = fileSessionBackend(dir);
    backend.write(SESSION);

    expect(backend.read()).toEqual(SESSION);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(backend.where()).mode & 0o777).toBe(0o600);

    backend.clear();
    expect(backend.read()).toBeNull();
  });

  test("the keychain backend round-trips with the token in stdin, never argv", () => {
    const calls: Array<{ args: string[]; input?: string }> = [];
    let stored = "";
    const runSecurity: SecurityRun = (args, input) => {
      calls.push({ args, input });
      if (args[0] === "find-generic-password") return stored;
      if (args[0] === "-i") {
        const match = /-w ([0-9a-f]+)\n?$/.exec(input ?? "");
        stored = match?.[1] ?? "";
        return "";
      }
      if (args[0] === "delete-generic-password") {
        stored = "";
        return "";
      }
      throw new Error("unexpected security call");
    };

    const backend = keychainSessionBackend(runSecurity);
    backend.write(SESSION);
    expect(backend.read()).toEqual(SESSION);

    const hex = Buffer.from(JSON.stringify(SESSION), "utf8").toString("hex");
    expect(
      calls.some(
        (call) => call.input === `add-generic-password -U -s countersign -a session -w ${hex}\n`,
      ),
    ).toBe(true);
    for (const call of calls) {
      for (const arg of call.args) {
        expect(arg).not.toContain(TOKEN);
        expect(arg).not.toContain(hex);
      }
    }
  });

  test("an expired session reads as null through loadSession", () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);

    expect(loadSession(backend, SESSION.expiresAt)).toBeNull();
    expect(loadSession(backend, SESSION.expiresAt - 1)).toEqual(SESSION);
  });
});

describe("login", () => {
  test("saves the session, opens the link and prints the funding steps without the token", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    const out: string[] = [];
    const opened: string[] = [];
    let polls = 0;
    const { fetchImpl, calls } = fetchRecorder((url) => {
      if (url === `${HUB}/cli/login/start`) {
        return json({
          code: "ABCD-1234",
          deviceSecret: "device-secret",
          verifyUrl: "https://hub.test/verify",
          interval: 1,
          expiresAt: NOW + 600,
        });
      }
      if (url === `${HUB}/cli/login/poll`) {
        polls += 1;
        if (polls === 1) return json({ status: "pending" });
        return json({
          status: "approved",
          sessionToken: TOKEN,
          address: ADDRESS,
          expiresAt: SESSION.expiresAt,
        });
      }
      return json({}, 404);
    });

    await runLogin([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      open: (url) => opened.push(url),
      sleep: async () => {},
      now: () => NOW,
    });

    expect(backend.read()).toEqual(SESSION);
    expect(opened).toEqual(["https://hub.test/verify"]);

    const text = out.join("");
    expect(text).toContain(`Open this link and sign in: https://hub.test/verify`);
    expect(text).toContain(`The page will show this code: ABCD-1234`);
    expect(text).toContain(ADDRESS);
    expect(text).toContain("https://faucet.circle.com");
    expect(text).toContain("faucet.testnet.whitechain.io");
    expect(text).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
    expect(process.exitCode ?? 0).toBe(0);

    expect(calls[0]?.url).toBe(`${HUB}/cli/login/start`);
    expect(calls[1]?.url).toBe(`${HUB}/cli/login/poll`);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ deviceSecret: "device-secret" });
  });

  test("a 410 from the poll exits 1 without leaking the token", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    const out: string[] = [];
    const { fetchImpl } = fetchRecorder((url) => {
      if (url === `${HUB}/cli/login/start`) {
        return json({
          code: "ABCD-1234",
          deviceSecret: "device-secret",
          verifyUrl: "https://hub.test/verify",
          interval: 1,
          expiresAt: NOW + 600,
        });
      }
      return json({ error: "gone" }, 410);
    });

    await runLogin([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      open: () => {},
      sleep: async () => {},
      now: () => NOW,
    });

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain("The login expired. Run countersign login again.");
    expect(backend.read()).toBeNull();
    expect(out.join("")).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
  });
});

describe("logout", () => {
  test("clears the backend and posts the Bearer to the hub", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() => json({ ok: true }));

    await runLogout([], { backend, hub: HUB, write: (t) => out.push(t), fetchImpl });

    expect(backend.read()).toBeNull();
    expect(out.join("")).toBe("Signed out.\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${HUB}/cli/logout`);
    expect(calls[0]?.init?.method).toBe("POST");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(out.join("")).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
  });
});

describe("whoami", () => {
  test("writes the address, the expiry and the injected balances", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() =>
      json({ address: ADDRESS, expiresAt: SESSION.expiresAt }),
    );

    await runWhoami([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      balances: async () => "12.5 USDC on Arc, 3 USDT on Whitechain",
    });

    const text = out.join("");
    expect(text).toContain(
      `Signed in as ${ADDRESS} until ${new Date(SESSION.expiresAt * 1000).toISOString()}`,
    );
    expect(text).toContain("12.5 USDC on Arc, 3 USDT on Whitechain");
    expect(text).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("with no session it writes NOT_SIGNED_IN and exits 1", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    const out: string[] = [];
    const { fetchImpl } = fetchRecorder(() => json({}, 500));

    await runWhoami([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      balances: async () => "unavailable",
    });

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain(NOT_SIGNED_IN);
    expect(out.join("")).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
  });

  test("a 401 writes NOT_SIGNED_IN and exits 1", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl } = fetchRecorder(() => json({ error: "unauthorized" }, 401));

    await runWhoami([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      balances: async () => "unavailable",
    });

    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain(NOT_SIGNED_IN);
    expect(out.join("")).not.toContain(TOKEN);
    expect(stderr.join("")).not.toContain(TOKEN);
  });
});

describe("useSession", () => {
  test("sets CS_SESSION and CS_HUB from a stored session, binds CS_HUB to the session's own hub, and is false with neither", () => {
    // os.homedir() is fixed when the process starts, so the session lives in a child whose HOME is the temp dir.
    const script = `
      import { fileSessionBackend } from ${JSON.stringify(join(import.meta.dir, "../src/session.ts"))};
      import { useSession } from ${JSON.stringify(join(import.meta.dir, "../src/cli.ts"))};
      const session = ${JSON.stringify(SESSION)};

      const none = {};
      if (useSession(none) !== false) process.exit(2);

      fileSessionBackend().write(session);
      const fresh = {};
      if (useSession(fresh) !== true) process.exit(3);
      if (fresh.CS_SESSION !== session.token) process.exit(4);
      if (fresh.CS_HUB !== session.hub) process.exit(5);

      const kept = { CS_HUB: "https://other.test" };
      if (useSession(kept) !== true) process.exit(6);
      if (kept.CS_SESSION !== session.token) process.exit(7);
      if (kept.CS_HUB !== session.hub) process.exit(8);

      process.stdout.write("ok");
    `;
    const result = Bun.spawnSync(["bun", "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, HOME: tmp, COUNTERSIGN_KEYSTORE: "file" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("ok");
  });

  test("returns true and touches nothing with the CI key override", () => {
    const env: Record<string, string | undefined> = { CS_BUYER_KEY: "0xabc" };
    expect(useSession(env)).toBe(true);
    expect(env.CS_SESSION).toBeUndefined();
    expect(env.CS_HUB).toBeUndefined();
  });
});

describe("DX", () => {
  test("withHub prefers the flag, then CS_HUB, then the default", () => {
    expect(withHub(["--hub", "http://flag"], { CS_HUB: "http://env" })).toEqual([
      "--hub",
      "http://flag",
    ]);
    expect(withHub(["--hub=http://flag"], { CS_HUB: "http://env" })).toEqual([
      "--hub=http://flag",
    ]);
    expect(withHub([], { CS_HUB: "http://env" })).toEqual(["--hub", "http://env"]);
    expect(withHub([], {})).toEqual(["--hub", DEFAULT_HUB]);
  });

  test("buy --help prints the command usage and calls no dep", async () => {
    const calls: string[] = [];
    await run(["buy", "--help"], inertDeps(calls));

    const usage = COMMAND_USAGE.buy;
    expect(usage).toBeDefined();
    expect(stdout.join("")).toBe(usage ?? "");
    expect(calls).toEqual([]);
  });

  test("VERSION is 0.1.1", () => {
    expect(VERSION).toBe("0.1.1");
  });
});
