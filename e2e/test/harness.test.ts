/**
 * Offline tests of the harness itself: no keys, no network, no chain. The flows are not run here.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAmount, planBudget, units, type Wallet } from "../lib/budget.ts";
import { check, equal, NotRun, runFlow, type Flow, type RunEnv } from "../lib/flow.ts";
import { spawnProc, runCmd } from "../lib/procs.ts";
import { renderRun } from "../lib/report.ts";
import { parseEnv, Secrets } from "../lib/secrets.ts";

const KEY = `0x${"ab".repeat(32)}`;
const TOKEN = "t0ken-t0ken-t0ken-t0ken-t0ken";

function env(dir: string, secrets = Secrets.fromEntries({})): RunEnv {
  return { runId: "test-run", startedAt: new Date(0), dir, secrets, shared: new Map(), options: {}, log: () => undefined };
}

describe("secrets", () => {
  test("parses env lines, quotes and export", () => {
    const m = parseEnv(`# c\nA=1\nexport B="two"\nC='three'\n bad line\nD=`);
    expect(m.get("A")).toBe("1");
    expect(m.get("B")).toBe("two");
    expect(m.get("C")).toBe("three");
    expect(m.get("D")).toBe("");
    expect(m.has("bad")).toBe(false);
  });

  test("redacts keys with and without 0x, and tokens, but not addresses", () => {
    const s = Secrets.fromEntries({ X_KEY: KEY, X_ADDRESS: "0x1111111111111111111111111111111111111111", MERCHANT_TOKEN: TOKEN });
    const text = `k=${KEY} raw=${KEY.slice(2)} upper=${KEY.slice(2).toUpperCase()} t=${TOKEN} a=0x1111111111111111111111111111111111111111`;
    const out = s.redact(text);
    expect(out).not.toContain(KEY.slice(2).toLowerCase());
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("0x1111111111111111111111111111111111111111");
    expect(out).not.toContain(KEY.slice(2).toUpperCase());
    expect(out.match(/\[redacted\]/g)?.length).toBe(4);
    expect(s.leaks(text)).toBe(true);
    expect(s.leaks(out)).toBe(false);
  });

  test("never names a value in its errors", () => {
    const s = Secrets.fromEntries({ BAD_KEY: "not-a-key-but-long-enough" });
    expect(() => s.key("BAD_KEY")).toThrow("BAD_KEY is not a 32-byte hex key");
    expect(() => s.get("MISSING_KEY")).toThrow("MISSING_KEY is not set");
  });
});

describe("processes", () => {
  test("a child's output is redacted in memory and on disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-proc-"));
    const s = Secrets.fromEntries({ CHILD_KEY: KEY });
    const r = await runCmd(
      { name: "child", cmd: ["bun", "-e", "console.log('key=' + process.env.CHILD_KEY); console.error('done')"], env: { CHILD_KEY: KEY }, log: join(dir, "child.log"), redact: (t) => s.redact(t) },
      20_000,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("key=[redacted]\n");
    expect(r.stderr).toContain("done");
    const log = readFileSync(join(dir, "child.log"), "utf8");
    expect(log).not.toContain(KEY.slice(2));
    expect(log).toContain("! done");
  });

  test("waitFor resolves on output and stop ends a long-running child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-proc-"));
    const p = spawnProc({ name: "sleeper", cmd: ["bun", "-e", "console.log('ready 42'); setInterval(() => {}, 1000)"], log: join(dir, "s.log"), redact: (t) => t });
    const m = await p.waitFor(/ready (\d+)/, 10_000);
    expect(m[1]).toBe("42");
    expect(p.alive()).toBe(true);
    await p.stop(2000);
    expect(p.alive()).toBe(false);
  });

  test("waitFor rejects when the child exits first", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-proc-"));
    const p = spawnProc({ name: "quitter", cmd: ["bun", "-e", "console.log('bye')"], log: join(dir, "q.log"), redact: (t) => t });
    await expect(p.waitFor(/never/, 10_000)).rejects.toThrow("quitter exited before printing");
  });
});

describe("flows", () => {
  test("the first failed step names itself, later steps do not run, cleanups run last in first out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-flow-"));
    const order: string[] = [];
    const flow: Flow = {
      name: "demo",
      title: "demo",
      owner: "orch-cs",
      network: "none",
      async run(ctx) {
        ctx.defer(() => order.push("first cleanup"));
        ctx.defer(() => order.push("second cleanup"));
        await ctx.step("one", () => order.push("one"));
        await ctx.step("two", () => equal(1 + 1, 3, "arithmetic"));
        await ctx.step("three", () => order.push("three"));
      },
    };
    const r = await runFlow(flow, env(dir));
    expect(r.status).toBe("FAIL");
    expect(r.failedStep).toBe("two");
    expect(r.error).toBe("arithmetic: expected 3, got 2");
    expect(r.steps.map((s) => `${s.name}:${s.ok}`)).toEqual(["one:true", "two:false"]);
    expect(order).toEqual(["one", "second cleanup", "first cleanup"]);
  });

  test("a missing shared output makes the flow NOT RUN", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-flow-"));
    const flow: Flow = { name: "needy", title: "needy", owner: "orch-cs", network: "none", async run(ctx) { ctx.take("x", "arc-spine"); } };
    const r = await runFlow(flow, env(dir));
    expect(r.status).toBe("NOT RUN (needs arc-spine)");
  });

  test("a flow that hangs fails in the step it hung in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "e2e-flow-"));
    const flow: Flow = {
      name: "slow",
      title: "slow",
      owner: "orch-cs",
      network: "none",
      timeoutMs: 200,
      async run(ctx) {
        await ctx.step("stuck", () => new Promise(() => undefined));
      },
    };
    const r = await runFlow(flow, env(dir));
    expect(r.status).toBe("FAIL");
    expect(r.failedStep).toBe("stuck");
    expect(r.error).toContain("timed out");
  });

  test("check narrows and throws its message", () => {
    expect(() => check(false, "nope")).toThrow("nope");
    expect(() => {
      throw new NotRun("x");
    }).toThrow("x");
  });
});

describe("budget", () => {
  const wallet = (id: string, balance: bigint): Wallet => ({
    id,
    label: id,
    network: "arc",
    asset: "USDC",
    address: "0x1111111111111111111111111111111111111111",
    decimals: 6,
    topUp: (amount) => `NEEDS-BROWSER faucet | top up ${id} | ${amount}`,
    read: async () => balance,
  });
  const spender = (name: string, w: Wallet, amount: bigint, floor: bigint): Flow => ({
    name,
    title: name,
    owner: "orch-cs",
    network: "arc",
    spends: () => [{ wallet: w, amount, floor }],
    run: async () => undefined,
  });

  test("flows are checked against what earlier flows leave", async () => {
    const w = wallet("w", 250n);
    const plan = await planBudget([spender("a", w, 100n, 100n), spender("b", w, 100n, 100n)], env(mkdtempSync(join(tmpdir(), "e2e-b-"))));
    expect(plan.short.has("a")).toBe(false);
    expect(plan.short.has("b")).toBe(true);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]).toContain("top up w");
  });

  test("an unreadable balance never skips a flow", async () => {
    const w: Wallet = { ...wallet("w", 0n), read: async () => { throw new Error("rpc down"); } };
    const plan = await planBudget([spender("a", w, 100n, 100n)], env(mkdtempSync(join(tmpdir(), "e2e-b-"))));
    expect(plan.short.size).toBe(0);
    expect(plan.balances.get("w")).toBeInstanceOf(Error);
  });

  test("amounts format and parse", () => {
    expect(formatAmount(10_000n, 6)).toBe("0.01");
    expect(formatAmount(units("1.5", 18), 18)).toBe("1.5");
    expect(units("0.05", 6)).toBe(50_000n);
    expect(formatAmount(0n, 6)).toBe("0");
  });
});

describe("report", () => {
  test("the summary names failures by flow and step, links transactions and carries no machine paths", () => {
    const text = renderRun(
      [
        { name: "arc-spine", title: "t", owner: "orch-cs", network: "arc", status: "PASS", ms: 1234, steps: [{ name: "hub up", ok: true, ms: 10 }], txs: [{ network: "arc", label: "release", tx: `0x${"1".repeat(64)}`, url: `https://testnet.arcscan.app/tx/0x${"1".repeat(64)}` }], notes: [] },
        { name: "arc-wrong-amount", title: "t", owner: "orch-cs", network: "arc", status: "FAIL", ms: 99, steps: [{ name: "chain refuses a moved price", ok: false, ms: 5, error: "boom" }], failedStep: "chain refuses a moved price", error: "boom", txs: [], notes: [] },
        { name: "web", title: "t", owner: "cs-ui", network: "none", status: "NOT RUN (browser rule)", ms: 0, steps: [], txs: [], notes: [] },
      ],
      { runId: "r1", startedAt: new Date("2026-11-06T10:00:00Z"), ms: 5000, commit: "abc1234", branch: "cs/e2e", full: true, numbers: new Map([["arc-spine", "1"], ["arc-wrong-amount", "2"], ["web", "9"]]), budgetRequests: [] },
    );
    expect(text).toContain("| 1 | `arc-spine` | PASS |");
    expect(text).toContain("| 2 | `arc-wrong-amount` | FAIL |");
    expect(text).toContain("`chain refuses a moved price`");
    expect(text).toContain("NOT RUN (browser rule)");
    expect(text).toContain("](https://testnet.arcscan.app/tx/0x");
    expect(text).toContain("1 pass · 1 fail · 0 skipped · 1 not run");
    expect(text).toContain("15:30 IST");
    expect(text).not.toMatch(/\/Users\/|\/home\/|\/tmp\//);
  });
});

describe("run lock", () => {
  test("a second run waits until the first releases, and a dead owner's lock is taken over", async () => {
    const { acquireRunLock } = await import("../lib/lock.ts");
    const dir = mkdtempSync(join(tmpdir(), "e2e-lock-"));
    process.env.E2E_LOCK_DIR = join(dir, "lock");
    const release = await acquireRunLock("first", () => undefined);
    let second = false;
    const waiting = acquireRunLock("second", () => undefined).then((r) => {
      second = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(second).toBe(false);
    release();
    (await waiting)();
    expect(second).toBe(true);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "lock"));
    writeFileSync(join(dir, "lock", "owner"), "999999 ghost 2026-11-06T00:00:00Z\n");
    const taken = await acquireRunLock("third", () => undefined);
    taken();
    delete process.env.E2E_LOCK_DIR;
  }, 20_000);
});
