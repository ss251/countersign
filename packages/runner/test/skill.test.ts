import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { assertOffer } from "@countersign/core";
import { readSkill, runSkill, skillOffer } from "../src/skill.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "SKILL.md");

describe("readSkill", () => {
  test("parses front matter", async () => {
    const skill = await readSkill(FIXTURE);
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A tiny skill for the runner suite.");
    expect(skill.body).toContain("# Test Skill");
    expect(skill.body).not.toContain("name: test-skill");
  });

  test("hashes the file bytes", async () => {
    const skill = await readSkill(FIXTURE);
    const bytes = new Uint8Array(await Bun.file(FIXTURE).arrayBuffer());
    const expected = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    expect(skill.sha256).toBe(expected);
    expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runSkill", () => {
  test("returns only the requested section", async () => {
    const skill = await readSkill(FIXTURE);
    const output = runSkill(skill, { section: "greeting" });
    expect(output.name).toBe("test-skill");
    expect(output.sha256).toBe(skill.sha256);
    expect(output.text).toContain("## Greeting");
    expect(output.text).toContain("### Detail");
    expect(output.text).not.toContain("## Farewell");
  });

  test("throws for an unknown section", async () => {
    const skill = await readSkill(FIXTURE);
    expect(() => runSkill(skill, { section: "nope" })).toThrow();
  });
});

describe("skillOffer", () => {
  test("builds an offer the hub accepts", async () => {
    const skill = await readSkill(FIXTURE);
    const offer = skillOffer({
      seller: "0x1111111111111111111111111111111111111111",
      skill,
      price: "1000",
      deadline: 120,
      rails: ["escrow"],
      now: 1_700_000_000,
    });
    expect(() => assertOffer(offer)).not.toThrow();
    expect(offer.title).toBe("test-skill");
    expect(offer.adapter).toBe("skill");
    expect(offer.issuedAt).toBe(1_700_000_000);
    expect(offer.bond).toBe("0");
  });
});
