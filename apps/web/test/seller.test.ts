import { describe, expect, test } from "bun:test";
import { parseSkill, priceToAtomic, publishCommand, serveCommand } from "../src/routes/seller/logic.ts";

describe("parseSkill", () => {
  test("reads the name and description from the front matter", () => {
    const result = parseSkill(
      "---\nname: use-arc\ndescription: Move USDC across Arc.\n---\n# use-arc\n\nFollow the steps.\n",
    );
    expect(result).toEqual({
      ok: true,
      name: "use-arc",
      summary: "Move USDC across Arc.",
      body: "# use-arc\n\nFollow the steps.\n",
    });
  });

  test("refuses a file with no front matter block", () => {
    expect(parseSkill("# use-arc\n\nNo front matter here.\n")).toEqual({
      ok: false,
      error: "This file has no front matter. A SKILL.md starts with --- and a name.",
    });
  });

  test("refuses front matter without a name", () => {
    expect(parseSkill("---\ndescription: A skill without a name.\n---\n# body\n")).toEqual({
      ok: false,
      error: "The front matter needs a name.",
    });
  });

  test("strips surrounding quotes from values", () => {
    const result = parseSkill(
      "---\nname: \"use-arc\"\ndescription: 'Move \"USDC\" across Arc.'\n---\n# use-arc\n",
    );
    expect(result).toEqual({
      ok: true,
      name: "use-arc",
      summary: 'Move "USDC" across Arc.',
      body: "# use-arc\n",
    });
  });
});

describe("priceToAtomic", () => {
  test("converts a decimal price to atomic units", () => {
    expect(priceToAtomic("0.05")).toEqual({ ok: true, atomic: "50000" });
  });

  test("refuses a zero price", () => {
    expect(priceToAtomic("0")).toEqual({ ok: false, error: "The price must be above zero." });
  });

  test("refuses a price that is not a decimal", () => {
    expect(priceToAtomic("abc")).toEqual({
      ok: false,
      error: "Enter a price like 0.05, with at most 6 decimals.",
    });
  });

  test("refuses more than six decimals", () => {
    expect(priceToAtomic("0.0000001")).toEqual({
      ok: false,
      error: "Enter a price like 0.05, with at most 6 decimals.",
    });
  });
});

describe("publish commands", () => {
  const options = {
    hub: "https://hub.example",
    price: "50000",
    deadline: 120,
    rails: ["escrow", "whitechain"] as const,
    upstreamUrl: "https://example.com/skill",
    licence: "Apache 2.0",
  };

  test("builds the publish command with upstream, licence and two rails", () => {
    expect(publishCommand({ ...options, rails: [...options.rails] })).toBe(
      "bun packages/runner/src/cli.ts publish --hub https://hub.example --skill ./SKILL.md --price 50000 --deadline 120 --rails escrow,whitechain --upstream-url https://example.com/skill --licence 'Apache 2.0'",
    );
  });

  test("builds the same command with serve", () => {
    expect(serveCommand({ ...options, rails: [...options.rails] })).toBe(
      "bun packages/runner/src/cli.ts serve --hub https://hub.example --skill ./SKILL.md --price 50000 --deadline 120 --rails escrow,whitechain --upstream-url https://example.com/skill --licence 'Apache 2.0'",
    );
  });
});
