import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CeilingError, runInChild, scrubbedEnv } from "../src/child.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");

describe("scrubbedEnv", () => {
  test("keeps only PATH and a fresh HOME", () => {
    const env = scrubbedEnv({
      PATH: "/bin",
      CS_SELLER_KEY: "x",
      AWS_SECRET: "y",
      GH_TOKEN: "z",
      DB_PASS: "w",
    });
    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH"]);
    expect(env.PATH).toBe("/bin");
    expect(env.HOME?.length).toBeGreaterThan(0);
    const text = JSON.stringify(env);
    expect(text).not.toContain("CS_SELLER_KEY");
    expect(text).not.toContain("AWS_SECRET");
    expect(text).not.toContain("GH_TOKEN");
    expect(text).not.toContain("DB_PASS");
  });
});

describe("runInChild", () => {
  test("returns the skill output", async () => {
    const output = await runInChild(
      { adapter: "skill", skillPath: FIXTURE },
      { question: "hello" },
      { timeMs: 5000, maxOutputBytes: 100_000 },
    );
    expect(output).toMatchObject({ skill: "test-skill" });
    expect(typeof (output as { answer?: unknown }).answer).toBe("string");
  });

  test("rejects when the time ceiling is passed", async () => {
    await expect(
      runInChild(
        { adapter: "skill", skillPath: FIXTURE },
        {},
        { timeMs: 1, maxOutputBytes: 100_000 },
      ),
    ).rejects.toBeInstanceOf(CeilingError);
  });

  test("rejects when the output ceiling is passed", async () => {
    await expect(
      runInChild(
        { adapter: "skill", skillPath: FIXTURE },
        {},
        { timeMs: 5000, maxOutputBytes: 10 },
      ),
    ).rejects.toBeInstanceOf(CeilingError);
  });
});
