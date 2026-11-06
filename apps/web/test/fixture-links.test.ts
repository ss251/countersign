import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { rails, slips } from "../src/fixtures/index.ts";
import { explorerFor, verifySlip } from "../src/lib/verify.ts";
import { RailCard } from "../src/ui/RailCard.tsx";

/**
 * Fixture slips are signed over stand-in addresses, so moving them onto a real chain would
 * break their signatures. The rule instead: no explorer link is ever built from fixture data.
 */

const FILES = ["catalogue.json", "signed-slip.json", "index.ts"];

const sources = await Promise.all(FILES.map((name) => Bun.file(new URL(`../src/fixtures/${name}`, import.meta.url)).text()));

/** Every fixture address and transaction: a 0x value of exactly 40 or 64 hex digits. */
const hexValues = (source: string): string[] =>
  source.match(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])|0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) ?? [];

const fixtureValues = [...new Set(sources.flatMap(hexValues))];

const countersign = slips.filter((s) => s.slip.payment.accepted.scheme === "countersign");

const linkedFixtureValue = (href: string | undefined): string | undefined =>
  href ? fixtureValues.find((value) => href.includes(value)) : undefined;

describe("fixture links", () => {
  test("every fixture file contributes the values the guards check", () => {
    expect(sources.map((source) => hexValues(source).length).every((count) => count > 0)).toBe(true);
    expect(fixtureValues.length).toBeGreaterThan(0);
    expect(countersign.length).toBeGreaterThan(0);
    for (const { slip } of countersign) expect(fixtureValues).toContain(slip.settlement.transaction);
  });

  test("no verdict links a fixture address or transaction", async () => {
    for (const { slip } of countersign) {
      const verdict = await verifySlip(slip);
      for (const check of verdict.checks) expect(linkedFixtureValue(check.href)).toBeUndefined();
    }
  });

  test("the explorer is suppressed for fixture slips and kept for real ones", () => {
    for (const { slip } of countersign) {
      expect(explorerFor(slip, true)).toBeUndefined();
      const href = explorerFor(slip, false);
      expect(href).toMatch(/^https:\/\//);
      expect(href).toContain(encodeURIComponent(slip.settlement.transaction));
    }
  });

  test("a fixture rail card with a fixture transaction is never linked", () => {
    const tx = countersign[0]!.slip.settlement.transaction;
    for (const declaration of Object.values(rails)) {
      const html = renderToString(createElement(RailCard, { declaration, tx, link: false }));
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
      for (const href of hrefs) expect(linkedFixtureValue(href)).toBeUndefined();
    }
  });
});
