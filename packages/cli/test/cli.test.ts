import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { runnerArgs, run, USAGE, type CliDeps } from "../src/cli.ts";

interface Calls {
  runner: string[][];
  buyer: string[][];
  verify: string[][];
  mcpLoad: string[][];
  mcpMain: string[][];
}

function depsFor(overrides: Partial<CliDeps> = {}): { deps: CliDeps; calls: Calls } {
  const calls: Calls = { runner: [], buyer: [], verify: [], mcpLoad: [], mcpMain: [] };
  const deps: CliDeps = {
    runner: async (argv) => {
      calls.runner.push([...argv]);
    },
    loadBuyer: async () => {
      calls.buyer.push(process.argv.slice(2));
    },
    loadVerify: async () => {
      calls.verify.push(process.argv.slice(2));
    },
    loadMcp: async () => {
      calls.mcpLoad.push(process.argv.slice(2));
      return {
        main: async (argv: string[]) => {
          calls.mcpMain.push([...argv]);
        },
      };
    },
    ...overrides,
  };
  return { deps, calls };
}

let savedArgv: string[];
let stdout: string[];
let stderr: string[];
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  savedArgv = process.argv;
  stdout = [];
  stderr = [];
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((
    chunk: string | Uint8Array,
  ) => {
    stdout.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((
    chunk: string | Uint8Array,
  ) => {
    stderr.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.exitCode = 0;
  process.argv = savedArgv;
});

describe("runnerArgs", () => {
  test("maps an OpenAPI operation to serve", () => {
    expect(
      runnerArgs([
        "openapi",
        "--spec",
        "s.json",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ]),
    ).toEqual({
      ok: true,
      args: [
        "serve",
        "--openapi",
        "s.json",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ],
    });
  });

  test("maps --publish-only anywhere to publish and removes it", () => {
    expect(
      runnerArgs([
        "openapi",
        "--spec",
        "s.json",
        "--publish-only",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ]),
    ).toEqual({
      ok: true,
      args: [
        "publish",
        "--openapi",
        "s.json",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ],
    });
  });

  test("maps a skill to serve", () => {
    expect(runnerArgs(["skill", "./SKILL.md", "--price", "5000"])).toEqual({
      ok: true,
      args: ["serve", "--skill", "./SKILL.md", "--price", "5000"],
    });
  });

  test("refuses an OpenAPI operation with no spec", () => {
    expect(runnerArgs(["openapi", "--operation", "op"])).toEqual({
      ok: false,
      error: "countersign sell openapi needs --spec <spec.json>.",
    });
  });

  test("refuses a skill with no path", () => {
    expect(runnerArgs(["skill"])).toEqual({
      ok: false,
      error: "countersign sell skill needs the path to a SKILL.md.",
    });
  });

  test("refuses a skill whose path is a flag", () => {
    expect(runnerArgs(["skill", "--price", "1"])).toEqual({
      ok: false,
      error: "countersign sell skill needs the path to a SKILL.md.",
    });
  });

  test("refuses sell mcp", () => {
    expect(runnerArgs(["mcp"])).toEqual({
      ok: false,
      error:
        "countersign sell mcp is not available yet: the runner CLI sells a skill or an OpenAPI operation.",
    });
  });

  test("refuses an unknown adapter", () => {
    expect(runnerArgs(["frobnicate"])).toEqual({
      ok: false,
      error: "countersign sell takes skill or openapi.",
    });
  });
});

describe("run", () => {
  test("--version writes exactly the version", async () => {
    await run(["--version"], depsFor().deps);
    expect(stdout.join("")).toBe("countersign 0.1.0\n");
  });

  test("help, --help and no arguments write the usage", async () => {
    for (const argv of [["help"], ["--help"], []]) {
      stdout.length = 0;
      await run(argv, depsFor().deps);
      const text = stdout.join("");
      expect(text).toBe(USAGE);
      expect(text).toContain("countersign sell skill");
      expect(text).toContain("countersign sell openapi");
      expect(text).toContain("countersign discover|buy|envelope|journal");
      expect(text).toContain("countersign verify");
      expect(text).toContain("countersign mcp");
    }
  });

  test("refuses an unknown command without calling a dep", async () => {
    const { deps, calls } = depsFor();
    await run(["frobnicate"], deps);
    expect(process.exitCode).toBe(2);
    expect(stderr.join("")).toContain("unknown command 'frobnicate'");
    expect(calls).toEqual({ runner: [], buyer: [], verify: [], mcpLoad: [], mcpMain: [] });
  });

  test("sell openapi calls the runner once with the mapped arguments", async () => {
    const { deps, calls } = depsFor();
    await run(
      [
        "sell",
        "openapi",
        "--spec",
        "s.json",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ],
      deps,
    );
    expect(calls.runner).toEqual([
      [
        "serve",
        "--openapi",
        "s.json",
        "--operation",
        "op",
        "--price",
        "10000",
        "--hub",
        "http://hub.test",
      ],
    ]);
  });

  test("sell mcp refuses and calls nothing", async () => {
    const { deps, calls } = depsFor();
    await run(["sell", "mcp"], deps);
    expect(process.exitCode).toBe(2);
    expect(stderr.join("")).toContain("not available yet");
    expect(calls.runner).toEqual([]);
  });

  test("buy forwards the command and its flags", async () => {
    const { deps, calls } = depsFor();
    await run(["buy", "0xabc", "--input", "{}"], deps);
    expect(calls.buyer).toEqual([["buy", "0xabc", "--input", "{}"]]);
  });

  test("discover forwards its flags", async () => {
    const { deps, calls } = depsFor();
    await run(["discover", "--hub", "http://h"], deps);
    expect(calls.buyer).toEqual([["discover", "--hub", "http://h"]]);
  });

  test("verify drops its own command from the verifier's arguments", async () => {
    const { deps, calls } = depsFor();
    await run(["verify", "slip.json", "--rpc", "http://rpc"], deps);
    expect(calls.verify).toEqual([["slip.json", "--rpc", "http://rpc"]]);
  });

  test("mcp calls the package's main with the remaining flags", async () => {
    const { deps, calls } = depsFor();
    await run(["mcp", "--hub", "http://h"], deps);
    expect(calls.mcpMain).toEqual([["--hub", "http://h"]]);
  });

  test("mcp refuses when the package is absent", async () => {
    const { deps } = depsFor({
      loadMcp: async () => {
        throw new Error("missing");
      },
    });
    await run(["mcp"], deps);
    expect(process.exitCode).toBe(2);
    expect(stderr.join("")).toContain("needs @countersign-hub/mcp");
  });

  test("mcp refuses a package with no main", async () => {
    const { deps } = depsFor({ loadMcp: async () => ({}) });
    await run(["mcp"], deps);
    expect(process.exitCode).toBe(2);
    expect(stderr.join("")).toContain("has no main(argv) export.");
  });

  test("the bin prints its version", () => {
    const result = Bun.spawnSync(["bun", "packages/cli/src/bin.ts", "--version"], {
      cwd: join(import.meta.dir, "../../.."),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("countersign 0.1.0\n");
  });
});
