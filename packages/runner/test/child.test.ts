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

  test("keeps the seller's model variables for a skill child", () => {
    const env = scrubbedEnv(
      {
        PATH: "/bin",
        SKILL_MODEL_API_KEY: "sk-seller",
        SKILL_MODEL_BASE_URL: "https://models.example",
        SKILL_MODEL: "seller-model",
      },
      "0xlineage",
      "skill",
    );
    expect(env.SKILL_MODEL_API_KEY).toBe("sk-seller");
    expect(env.SKILL_MODEL_BASE_URL).toBe("https://models.example");
    expect(env.SKILL_MODEL).toBe("seller-model");
    expect(env.COUNTERSIGN_LINEAGE).toBe("0xlineage");
  });

  test("withholds the seller's model variables from every other adapter", () => {
    const parent = {
      PATH: "/bin",
      SKILL_MODEL_API_KEY: "sk-seller",
      SKILL_MODEL_BASE_URL: "https://models.example",
      SKILL_MODEL: "seller-model",
    };
    for (const adapter of ["mcp", "openapi", undefined] as Array<string | undefined>) {
      const env = scrubbedEnv(parent, "0xlineage", adapter);
      expect(env).not.toHaveProperty("SKILL_MODEL_API_KEY");
      expect(env).not.toHaveProperty("SKILL_MODEL_BASE_URL");
      expect(env).not.toHaveProperty("SKILL_MODEL");
      expect(JSON.stringify(env)).not.toContain("sk-seller");
      expect(env.PATH).toBe("/bin");
      expect(env.HOME?.length).toBeGreaterThan(0);
      expect(env.COUNTERSIGN_LINEAGE).toBe("0xlineage");
    }
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
