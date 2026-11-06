import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CeilingError, defaultSpawner, runInChild } from "../src/child.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");

describe("runInChild through node:child_process", () => {
  test("returns the skill output", async () => {
    const output = await runInChild(
      { adapter: "skill", skillPath: FIXTURE },
      { question: "hello" },
      { timeMs: 5000, maxOutputBytes: 100_000 },
      undefined,
      "node",
    );
    expect(output).toMatchObject({ name: "test-skill" });
    expect(typeof (output as { text?: unknown }).text).toBe("string");
  });

  test("rejects when the time ceiling is passed", async () => {
    await expect(
      runInChild(
        { adapter: "skill", skillPath: FIXTURE },
        {},
        { timeMs: 1, maxOutputBytes: 100_000 },
        undefined,
        "node",
      ),
    ).rejects.toBeInstanceOf(CeilingError);
  });

  test("rejects when the output ceiling is passed", async () => {
    await expect(
      runInChild(
        { adapter: "skill", skillPath: FIXTURE },
        {},
        { timeMs: 5000, maxOutputBytes: 10 },
        undefined,
        "node",
      ),
    ).rejects.toBeInstanceOf(CeilingError);
  });

  test("defaultSpawner() is bun under bun:test", () => {
    expect(defaultSpawner()).toBe("bun");
  });
});
