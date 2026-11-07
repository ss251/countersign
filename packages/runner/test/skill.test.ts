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

  test("reads the whitechain-dev folded description as real text", async () => {
    const path = join(import.meta.dir, "../../../examples/catalogue/whitechain/whitechain-dev/SKILL.md");
    const skill = await readSkill(path);
    expect(skill.name).toBe("whitechain-dev");
    expect(skill.description).not.toBe(">");
    expect(skill.description).toContain("Whitechain developer playbook.");
    expect(skill.description).toContain("Do not use this skill for transferring tokens");
    expect(skill.description).not.toContain("\n  ");
  });

  test("reads every Circle skill's front matter", async () => {
    const names = [
      "bridge-tokens",
      "use-arc",
      "use-gateway",
      "use-smart-contract-platform",
      "use-usdc",
    ];
    for (const name of names) {
      const path = join(import.meta.dir, "../../../examples/catalogue/circle", name, "SKILL.md");
      const skill = await readSkill(path);
      expect(skill.name).toBe(name);
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.description.startsWith('"')).toBe(false);
      expect(skill.body.startsWith("## Overview")).toBe(true);
    }
  });
});

describe("runSkill", () => {
  test("returns only the requested section", async () => {
    const skill = await readSkill(FIXTURE);
    const output = await runSkill(skill, { section: "greeting" });
    expect(output.skill).toBe("test-skill");
    expect(output.answer).toContain("## Greeting");
    expect(output.answer).toContain("### Detail");
    expect(output.answer).not.toContain("## Farewell");
    expect(output.version).toBe(skill.sha256.slice(0, 12));
    expect(output.skill).toBe("test-skill");
  });

  test("answers a question with the matching sections, never the whole file", async () => {
    const skill = await readSkill(FIXTURE);
    const output = await runSkill(skill, { question: "how do I say hello to someone" });
    expect(output.answer.length).toBeGreaterThan(0);
    expect(output.answer.length).toBeLessThan(skill.body.length);
    expect(output.answer.toLowerCase()).toContain("hello");
    expect(output.answer).not.toContain("## Farewell");
  });

  test("with no question and no section, returns the description and a table of contents", async () => {
    const skill = await readSkill(FIXTURE);
    const output = await runSkill(skill, {});
    expect(output.answer).toBe(skill.description);
  });

  test("a question with a model credential is answered by the model, not by the file", async () => {
    const skill = await readSkill(FIXTURE);
    let seen: { url: string; body: any } | undefined;
    const fetchImpl = (async (url: any, init: any) => {
      seen = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: "Hello there." } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const output = await runSkill(skill, { question: "how do I greet someone" }, {
      apiKey: "test", baseUrl: "https://example.test", model: "test-model", fetchImpl,
    });
    expect(output.answer).toBe("Hello there.");
    expect(seen?.url).toBe("https://example.test/chat/completions");
    expect(seen?.body.messages[0].content).toContain("Test Skill");
  });

  test("throws for an unknown section", async () => {
    const skill = await readSkill(FIXTURE);
    await expect(runSkill(skill, { section: "nope" })).rejects.toThrow();
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
