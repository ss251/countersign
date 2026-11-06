import { describe, expect, test } from "bun:test";
import { parseBuildArgs, parseSmokeArgs, planBuild } from "../args.ts";

describe("build arguments", () => {
  test("defaults to everything that exists", () => {
    const plan = planBuild({
      only: undefined,
      require: [],
      exists: (short) => short === "relay",
    });
    expect(plan.build).toEqual(["relay"]);
    expect(plan.skipped).toEqual(["mcp", "cli"]);
  });

  test("--only limits the candidates", () => {
    const plan = planBuild({
      only: ["relay"],
      require: [],
      exists: () => false,
    });
    expect(plan.build).toEqual([]);
    expect(plan.skipped).toEqual(["relay"]);
  });

  test("a missing required package fails and names it", () => {
    expect(() =>
      planBuild({
        only: undefined,
        require: ["mcp", "cli", "relay"],
        exists: (short) => short === "relay",
      }),
    ).toThrow(/missing required packages: mcp, cli/);
  });

  test("--require adds a package outside --only", () => {
    const plan = planBuild({
      only: ["relay"],
      require: ["mcp"],
      exists: () => true,
    });
    expect(plan.build).toEqual(["relay", "mcp"]);
  });

  test("parses the three build flags", () => {
    expect(
      parseBuildArgs(["--only", "mcp,cli", "--require", "relay", "--out", "custom"]),
    ).toEqual({ only: ["mcp", "cli"], require: ["relay"], out: "custom" });
  });

  test("parses --flag=value form", () => {
    expect(parseBuildArgs(["--only=relay", "--out=.release-test"])).toEqual({
      only: ["relay"],
      require: [],
      out: ".release-test",
    });
  });

  test("rejects unknown packages and arguments", () => {
    expect(() => parseBuildArgs(["--only", "nope"])).toThrow(/unknown package/);
    expect(() => parseBuildArgs(["--watch"])).toThrow(/unknown argument/);
  });

  test("parses the smoke directory", () => {
    expect(parseSmokeArgs(["--dir", ".release-test"])).toEqual({ dir: ".release-test" });
    expect(parseSmokeArgs([])).toEqual({ dir: ".release" });
  });
});
