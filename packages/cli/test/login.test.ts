import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
import { assertHubUrl, runLogin, runLogout, runWhoami, safeConsoleUrl } from "../src/login.ts";
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
const CONSOLE = "https://counter-sign.up.railway.app";
const VERIFY_URL = `${CONSOLE}/#/cli-login?code=ABCD-1234`;
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

  test("a symlink at session.json is refused on read without leaking it", () => {
    const dir = join(tmp, "config");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = join(tmp, "elsewhere.json");
    writeFileSync(target, `${JSON.stringify(SESSION)}\n`, { mode: 0o600 });
    symlinkSync(target, join(dir, "session.json"));
    const backend = fileSessionBackend(dir);

    expect(backend.read()).toBeNull();
    expect(stderr.join("")).toContain(backend.where());
    expect(stderr.join("")).not.toContain(TOKEN);
  });

  test("a symlinked session directory is refused on read", () => {
    const real = join(tmp, "real");
    mkdirSync(real, { recursive: true, mode: 0o700 });
    writeFileSync(join(real, "session.json"), `${JSON.stringify(SESSION)}\n`, { mode: 0o600 });
    const link = join(tmp, "linked");
    symlinkSync(real, link);
    const backend = fileSessionBackend(link);

    expect(backend.read()).toBeNull();
    expect(stderr.join("")).toContain(link);
    expect(stderr.join("")).not.toContain(TOKEN);
  });

  test("a 0644 session file is refused on read without leaking it", () => {
    const dir = join(tmp, "config");
    const backend = fileSessionBackend(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(backend.where(), `${JSON.stringify(SESSION)}\n`, { mode: 0o644 });
    chmodSync(backend.where(), 0o644);

    expect(backend.read()).toBeNull();
    expect(stderr.join("")).toContain(backend.where());
    expect(stderr.join("")).not.toContain(TOKEN);
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
          verifyUrl: VERIFY_URL,
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
    expect(opened).toEqual([VERIFY_URL]);

    const text = out.join("");
    expect(text).toContain(`Open this link and sign in: ${VERIFY_URL}`);
    expect(text).toContain(`The page will show this code: ABCD-1234`);
    expect(text).toContain(ADDRESS);
    expect(text).toContain("https://faucet.circle.com");
    expect(text).toContain("On Whitechain you need test USDT only: the relay pays the gas.");
    expect(text).not.toContain("faucet.testnet.whitechain.io");
    expect(text).not.toContain("WBT");
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

  test("an unsafe verifyUrl is printed but never opened", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    const out: string[] = [];
    const opened: string[] = [];
    const unsafe = `${CONSOLE}/#/cli-login?code=ABCD-1234&calc`;
    const { fetchImpl } = fetchRecorder((url) => {
      if (url === `${HUB}/cli/login/start`) {
        return json({
          code: "ABCD-1234",
          deviceSecret: "device-secret",
          verifyUrl: unsafe,
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
      open: (url) => opened.push(url),
      sleep: async () => {},
      now: () => NOW,
    });

    expect(opened).toEqual([]);
    expect(out.join("")).toContain(`Open this link and sign in: ${unsafe}`);
  });

  test("login --hub http://evil.example exits non-zero without any fetch", async () => {
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
    try {
      await run(["login", "--hub", "http://evil.example"], inertDeps([]));
    } finally {
      globalThis.fetch = original;
    }

    expect(fetches).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain("Refused: the countersign hub must be https.");
  });
});

describe("safeConsoleUrl", () => {
  test("accepts the console's https link", () => {
    const url = `${CONSOLE}/#/cli-login?code=ABCD-EFGH`;
    expect(safeConsoleUrl(url)).toBe(url);
  });

  test("refuses http, another origin, shell characters, whitespace and javascript:", () => {
    expect(safeConsoleUrl(`${CONSOLE.replace("https:", "http:")}/#/cli-login?code=ABCD-EFGH`)).toBeNull();
    expect(safeConsoleUrl("https://evil.example/#/cli-login?code=ABCD-EFGH")).toBeNull();
    expect(safeConsoleUrl(`${CONSOLE}/#/cli-login?code=ABCD-EFGH&calc`)).toBeNull();
    expect(safeConsoleUrl(`${CONSOLE}/#/cli-login?code=ABCD-EFGH|x`)).toBeNull();
    expect(safeConsoleUrl(`${CONSOLE}/#/cli-login?code=AB CD`)).toBeNull();
    expect(safeConsoleUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("assertHubUrl", () => {
  test("accepts https hubs and plain http on the local machine", () => {
    expect(assertHubUrl("https://hub-production-e85e.up.railway.app")).toBe(
      "https://hub-production-e85e.up.railway.app",
    );
    expect(assertHubUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(assertHubUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(assertHubUrl("http://[::1]:8787")).toBe("http://[::1]:8787");
  });

  test("refuses a plain-http hub elsewhere", () => {
    expect(() => assertHubUrl("http://evil.example")).toThrow(
      "Refused: the countersign hub must be https.",
    );
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

  test("posts the revoke only to the session's own hub, never CS_HUB", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() => json({ ok: true }));

    await runLogout([], { backend, hub: "https://evil.example", write: (t) => out.push(t), fetchImpl });

    expect(calls.map((call) => call.url)).toEqual([`${HUB}/cli/logout`]);
    expect(calls.some((call) => call.url.includes("evil.example"))).toBe(false);
    expect(out.join("")).toBe("Signed out.\n");
    expect(backend.read()).toBeNull();
  });

  test("a 500 warns that the hub did not confirm and still clears the session", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl } = fetchRecorder(() => json({ error: "boom" }, 500));

    await runLogout([], { backend, hub: "https://evil.example", write: (t) => out.push(t), fetchImpl });

    const expiry = new Date(SESSION.expiresAt * 1000).toISOString();
    expect(out.join("")).toBe(
      `Signed out here; the hub did not confirm, so the session stays valid until ${expiry}.\n`,
    );
    expect(backend.read()).toBeNull();
  });

  test("a network error warns that the hub did not confirm and still clears the session", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await runLogout([], { backend, hub: "https://evil.example", write: (t) => out.push(t), fetchImpl });

    const expiry = new Date(SESSION.expiresAt * 1000).toISOString();
    expect(out.join("")).toBe(
      `Signed out here; the hub did not confirm, so the session stays valid until ${expiry}.\n`,
    );
    expect(backend.read()).toBeNull();
  });

  test("with no session it says so and never fetches", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() => json({ ok: true }));

    await runLogout([], { backend, hub: HUB, write: (t) => out.push(t), fetchImpl });

    expect(calls).toHaveLength(0);
    expect(out.join("")).toBe("Not signed in.\n");
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

  test("sends the token only to the session's own hub, never CS_HUB", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write(SESSION);
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() =>
      json({ address: ADDRESS, expiresAt: SESSION.expiresAt }),
    );

    await runWhoami([], {
      backend,
      hub: "https://evil.example",
      write: (t) => out.push(t),
      fetchImpl,
      balances: async () => "unavailable",
    });

    expect(calls.map((call) => call.url)).toEqual([`${HUB}/cli/session`, `${HUB}/cli/hedera/account`]);
    expect(calls.some((call) => call.url.includes("evil.example"))).toBe(false);
    expect(out.join("")).toContain(`Signed in as ${ADDRESS}`);
  });

  test("a stored session with an unsafe hub clears the session and exits 1 without a fetch", async () => {
    const backend = fileSessionBackend(join(tmp, "config"));
    backend.write({ ...SESSION, hub: "http://evil.example" });
    const out: string[] = [];
    const { fetchImpl, calls } = fetchRecorder(() =>
      json({ address: ADDRESS, expiresAt: SESSION.expiresAt }),
    );

    await runWhoami([], {
      backend,
      hub: HUB,
      write: (t) => out.push(t),
      fetchImpl,
      balances: async () => "unavailable",
    });

    expect(calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    expect(stderr.join("")).toContain(NOT_SIGNED_IN);
    expect(backend.read()).toBeNull();
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

  test("a stored session whose hub is plain http is refused and sets nothing", () => {
    const script = `
      import { fileSessionBackend } from ${JSON.stringify(join(import.meta.dir, "../src/session.ts"))};
      import { useSession } from ${JSON.stringify(join(import.meta.dir, "../src/cli.ts"))};
      fileSessionBackend().write(${JSON.stringify({ ...SESSION, hub: "http://evil.example" })});

      const env = {};
      if (useSession(env) !== false) process.exit(2);
      if (env.CS_SESSION !== undefined) process.exit(3);
      if (env.CS_HUB !== undefined) process.exit(4);

      process.stdout.write("ok");
    `;
    const result = Bun.spawnSync(["bun", "-e", script], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, HOME: tmp, COUNTERSIGN_KEYSTORE: "file" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("ok");
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

  test("VERSION is 0.1.3", () => {
    expect(VERSION).toBe("0.1.3");
  });
});
