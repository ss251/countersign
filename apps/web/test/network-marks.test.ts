import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RAIL_IDS } from "@countersign/core";
import { SettlesOn, settlingNetworks } from "../src/routes/home/SettlesOn.tsx";
import { NetworkMark, NetworkName, RailName, namedNetwork, railNetwork } from "../src/ui/NetworkMark.tsx";
import { RailTag } from "../src/ui/primitives.tsx";
import type { RailDeclaration } from "../src/lib/types.ts";

/**
 * STEER-0713b: the networks' official marks, byte for byte. Each sha256 below is the file as downloaded on
 * 07 Nov from the network's own source (the PR lists the URLs): Circle's Arc logo pack, Hedera's logo library
 * on brand.hedera.com, and whitechain.io's own files.
 */
const OFFICIAL: Record<string, string> = {
  "arc-light.svg": "0c641405f429884228c0db4287e1b89774d21973c2d443b028b7cfa854c6f828",
  "arc-dark.svg": "0c641405f429884228c0db4287e1b89774d21973c2d443b028b7cfa854c6f828",
  "hedera-light.svg": "bc2dd47c72ffc6174274fa3f589cdb1ebe58d276ca71f3ce6d190632e64b641b",
  "hedera-dark.svg": "4a4141d69c961a734befeef1afe55451077f0fed1001960201b2ee8373458d2c",
  "whitechain-light.svg": "83367da71339cde3f742171b37290c37471c3e1903d18304abcd2b4b1f8ef68f",
  "whitechain-dark.svg": "24ffb2a2d64d69a667f53c98986e26eb1fd52b0a51af00fb0790fbd9920059a2",
};

const mark = (name: string) => readFileSync(new URL(`../public/marks/${name}`, import.meta.url));

describe("the networks' own marks (STEER-0713b)", () => {
  test("each file is the official one, unchanged, and is plain SVG with nothing active in it", () => {
    for (const [name, sha] of Object.entries(OFFICIAL)) {
      const bytes = mark(name);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
      const text = bytes.toString("utf8");
      expect(text).toContain("<svg");
      expect(text).not.toMatch(/<script|<foreignObject|<image|on[a-z]+=|javascript:|href="http/i);
    }
  });

  test("every rail maps to its network, and only Stripe's MPP has none", () => {
    const expected: Record<string, string | null> = {
      escrow: "arc",
      eip3009: "arc",
      gateway: "arc",
      erc8183: "arc",
      whitechain: "whitechain",
      hedera: "hedera",
      "hedera-scheduled": "hedera",
      mpp: null,
    };
    expect(([...RAIL_IDS] as string[]).sort()).toEqual(Object.keys(expected).sort());
    for (const rail of RAIL_IDS) expect(railNetwork(rail)).toBe(expected[rail] as never);
    expect(namedNetwork("Arc testnet")).toBe("arc");
    expect(namedNetwork("Whitechain Sepolia")).toBe("whitechain");
    expect(namedNetwork("Hedera testnet")).toBe("hedera");
    expect(namedNetwork("Stripe")).toBeNull();
  });

  test("a mark is decorative beside its name, sized up front, with the light and dark files", () => {
    const html = renderToString(createElement(NetworkMark, { network: "hedera" }));
    expect(html.match(/<img /g)?.length).toBe(2);
    expect(html.match(/alt=""/g)?.length).toBe(2);
    expect(html.match(/width="16" height="16"/g)?.length).toBe(2);
    expect(html).toContain('src="/marks/hedera-light.svg"');
    expect(html).toContain('src="/marks/hedera-dark.svg"');
  });

  test("rail badges and rail and network names carry the mark and keep their words", () => {
    const tag = renderToString(createElement(RailTag, { rail: "whitechain" }));
    expect(tag).toContain('src="/marks/whitechain-light.svg"');
    expect(tag).toContain("Whitechain · USDT");
    expect(renderToString(createElement(RailName, { rail: "escrow" }))).toContain('src="/marks/arc-light.svg"');
    expect(renderToString(createElement(RailName, { rail: "mpp" }))).not.toContain("<img");
    expect(renderToString(createElement(NetworkName, { name: "Hedera testnet" }))).toContain('src="/marks/hedera-light.svg"');
  });

  test("the landing's row names the networks with a live rail, each linking to its site, with Arc's attribution", () => {
    const rails = (ids: string[]) => ids.map((id) => ({ id })) as unknown as RailDeclaration[];
    expect(settlingNetworks(undefined)).toEqual(["arc", "hedera", "whitechain"]);
    expect(settlingNetworks(rails(["escrow", "whitechain", "hedera-scheduled"]))).toEqual(["arc", "hedera", "whitechain"]);
    expect(settlingNetworks(rails(["escrow", "whitechain"]))).toEqual(["arc", "whitechain"]);

    const html = renderToString(createElement(SettlesOn, { rails: rails(["escrow", "whitechain", "hedera-scheduled"]) }));
    expect(html).toContain("Settles on");
    for (const href of ["https://www.arc.io", "https://hedera.com", "https://whitechain.io"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates.");
    expect(html).not.toMatch(/partner|official|endorse/i);
  });

  test("the row sits after the journey (the five parties) and outside the hero", () => {
    const src = readFileSync(new URL("../src/routes/home/index.tsx", import.meta.url), "utf8");
    const journey = src.indexOf("<JourneyStage");
    const row = src.indexOf("<SettlesOn");
    const stream = src.indexOf("<Stream ");
    expect(journey).toBeGreaterThan(0);
    expect(row).toBeGreaterThan(journey);
    expect(stream).toBeGreaterThan(row);
    expect(readFileSync(new URL("../src/routes/home/Hero.tsx", import.meta.url), "utf8")).not.toContain("SettlesOn");
  });
});
