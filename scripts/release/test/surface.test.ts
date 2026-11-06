import { describe, expect, test } from "bun:test";
import {
  bundleEntries,
  entrySources,
  sourceTargetMap,
  stagedManifest,
  type PackageManifest,
} from "../manifest.ts";
import {
  PEER_COMPLETIONS,
  PUBLISH_SURFACE,
  completePeerDependencies,
  exportKeys,
  extraDependenciesFor,
  extraEntriesFor,
  omittedExportLines,
  peerCompletionsFor,
  type PublishSurface,
} from "../surface.ts";

const relay: PackageManifest = {
  name: "@countersign/relay",
  version: "0.1.0",
  bin: { countersign: "./src/cli.ts" },
  exports: {
    ".": "./src/index.ts",
    "./paywall": "./src/paywall.ts",
    "./pay-fetch": "./src/pay-fetch.ts",
    "./browser": "./src/browser.ts",
  },
};

describe("the publish surface", () => {
  test("the relay allowlist filters entries and staged exports but keeps bin", () => {
    const entries = entrySources(relay, { short: "relay", surface: PUBLISH_SURFACE });
    expect(entries).toEqual([
      "./src/paywall.ts",
      "./src/pay-fetch.ts",
      "./src/browser.ts",
      "./src/cli.ts",
    ]);

    const staged = stagedManifest({
      short: "relay",
      manifest: relay,
      dependencies: {},
      targets: sourceTargetMap(entries),
      surface: PUBLISH_SURFACE,
    });
    expect(staged.exports).toEqual({
      "./paywall": "./dist/paywall.js",
      "./pay-fetch": "./dist/pay-fetch.js",
      "./browser": "./dist/browser.js",
    });
    expect(staged.bin).toEqual({ countersign: "./dist/cli.js" });
  });

  test("an allowlisted key the manifest does not export throws and names it", () => {
    const incomplete: PackageManifest = {
      version: "0.1.0",
      exports: {
        ".": "./src/index.ts",
        "./paywall": "./src/paywall.ts",
        "./browser": "./src/browser.ts",
      },
    };

    let message = "";
    try {
      entrySources(incomplete, { short: "relay", surface: PUBLISH_SURFACE });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('"./pay-fetch"');
    expect(message).toContain("packages/relay/package.json");

    expect(() =>
      stagedManifest({
        short: "relay",
        manifest: incomplete,
        dependencies: {},
        targets: {},
        surface: PUBLISH_SURFACE,
      }),
    ).toThrow(/\.\/pay-fetch/);
  });

  test("a package with no table entry publishes every export", () => {
    const entries = entrySources(relay, { short: "mcp", surface: PUBLISH_SURFACE });
    expect(entries).toEqual([
      "./src/index.ts",
      "./src/paywall.ts",
      "./src/pay-fetch.ts",
      "./src/browser.ts",
      "./src/cli.ts",
    ]);

    const staged = stagedManifest({
      short: "mcp",
      manifest: relay,
      dependencies: {},
      targets: sourceTargetMap(entries),
      surface: PUBLISH_SURFACE,
    });
    expect(staged.exports).toEqual({
      ".": "./dist/index.js",
      "./paywall": "./dist/paywall.js",
      "./pay-fetch": "./dist/pay-fetch.js",
      "./browser": "./dist/browser.js",
    });
  });

  test("every omitted export key gets one not-published line", () => {
    expect(omittedExportLines("relay", "packages/relay/package.json", relay.exports)).toEqual([
      'relay: "." not published (not on the publish surface: ' +
        "packages/relay/package.json exports it for the workspace)",
    ]);

    const surface: PublishSurface = { pkg: ["./keep"] };
    expect(
      omittedExportLines(
        "pkg",
        "packages/pkg/package.json",
        {
          ".": "./src/index.ts",
          "./keep": "./src/keep.ts",
          "./drop": "./src/drop.ts",
        },
        surface,
      ),
    ).toEqual([
      'pkg: "." not published (not on the publish surface: ' +
        "packages/pkg/package.json exports it for the workspace)",
      'pkg: "./drop" not published (not on the publish surface: ' +
        "packages/pkg/package.json exports it for the workspace)",
    ]);
  });

  test("export keys name the implicit root for string and conditional exports", () => {
    expect(exportKeys("./src/index.ts")).toEqual(["."]);
    expect(exportKeys({ import: "./src/index.ts" })).toEqual(["."]);
    expect(exportKeys(undefined)).toEqual([]);
    expect(exportKeys({ "./sub": "./src/sub.ts" })).toEqual(["./sub"]);
  });

  test("cli extra entries join the bundle list but not bin or exports", () => {
    const cli: PackageManifest = {
      name: "countersign",
      version: "0.1.0",
      engines: { node: ">=22" },
      bin: { countersign: "./src/bin.ts" },
    };
    const entries = entrySources(cli, { short: "cli", surface: PUBLISH_SURFACE });
    expect(entries).toEqual(["./src/bin.ts"]);

    expect(bundleEntries("cli", cli, { short: "cli", surface: PUBLISH_SURFACE })).toEqual([
      { source: "packages/cli/src/bin.ts", target: "./dist/bin.js", extra: false },
      {
        source: "packages/runner/src/child-entry.ts",
        target: "dist/child-entry.js",
        extra: true,
      },
    ]);

    const staged = stagedManifest({
      short: "cli",
      manifest: cli,
      dependencies: {},
      targets: sourceTargetMap(entries),
      surface: PUBLISH_SURFACE,
    });
    expect(staged.bin).toEqual({ countersign: "./dist/bin.js" });
    expect(staged.exports).toBeUndefined();
    expect(JSON.stringify(staged)).not.toContain("child-entry");
  });

  test("relay and mcp have no extra entries or dependencies", () => {
    expect(extraEntriesFor("relay")).toEqual([]);
    expect(extraEntriesFor("mcp")).toEqual([]);
    expect(extraDependenciesFor("relay")).toEqual({});
    expect(extraDependenciesFor("mcp")).toEqual({});
  });
});

describe("peer completions", () => {
  const mcpCompletion = {
    package: "@x402/evm",
    needsBy: "@circle-fin/x402-batching",
    reason:
      "its server entry imports @x402/evm but lists it only as an optional peer, " +
      "which npm does not install",
  };

  test("the completion is added with the union range after the scan", () => {
    const plan = completePeerDependencies({
      short: "mcp",
      completions: peerCompletionsFor("mcp"),
      dependencies: { "@circle-fin/x402-batching": "4.0.0" },
      union: { "@circle-fin/x402-batching": "4.0.0", "@x402/evm": "2.30.0" },
    });
    expect(plan.dependencies).toEqual({
      "@circle-fin/x402-batching": "4.0.0",
      "@x402/evm": "2.30.0",
    });
  });

  test("the completed dependency keys are sorted", () => {
    const plan = completePeerDependencies({
      short: "mcp",
      completions: peerCompletionsFor("mcp"),
      dependencies: { zod: "4.6.7", "@circle-fin/x402-batching": "4.0.0" },
      union: {
        zod: "4.6.7",
        "@x402/evm": "2.30.0",
        "@circle-fin/x402-batching": "4.0.0",
      },
    });
    expect(Object.keys(plan.dependencies)).toEqual([
      "@circle-fin/x402-batching",
      "@x402/evm",
      "zod",
    ]);
  });

  test("a completion missing from the union throws naming it", () => {
    let message = "";
    try {
      completePeerDependencies({
        short: "mcp",
        completions: peerCompletionsFor("mcp"),
        dependencies: { "@circle-fin/x402-batching": "4.0.0" },
        union: { "@circle-fin/x402-batching": "4.0.0" },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("@x402/evm");
    expect(message).toContain("not a dependency of any repository manifest");
  });

  test("a stale completion is an error naming the missing needsBy", () => {
    let message = "";
    try {
      completePeerDependencies({
        short: "mcp",
        completions: peerCompletionsFor("mcp"),
        dependencies: {},
        union: { "@x402/evm": "2.30.0" },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(
      "stale peer completion for mcp: @x402/evm " +
        "(needed by @circle-fin/x402-batching, which is not a dependency)",
    );
  });

  test("an empty package, needsBy or reason throws", () => {
    expect(() =>
      peerCompletionsFor("mcp", { mcp: [{ package: "", needsBy: "x", reason: "y" }] }),
    ).toThrow(/empty package/);
    expect(() =>
      peerCompletionsFor("mcp", { mcp: [{ package: "x", needsBy: " ", reason: "y" }] }),
    ).toThrow(/empty needsBy/);
    expect(() =>
      peerCompletionsFor("mcp", { mcp: [{ package: "x", needsBy: "y", reason: "" }] }),
    ).toThrow(/empty reason/);
  });

  test("one printed line per completion", () => {
    const plan = completePeerDependencies({
      short: "mcp",
      completions: [mcpCompletion],
      dependencies: { "@circle-fin/x402-batching": "4.0.0" },
      union: { "@x402/evm": "2.30.0" },
    });
    expect(plan.lines).toEqual([
      "mcp: peer completion @x402/evm for @circle-fin/x402-batching " +
        "(its server entry imports @x402/evm but lists it only as an optional peer, " +
        "which npm does not install)",
    ]);
  });

  test("relay and cli have no peer completions", () => {
    expect(PEER_COMPLETIONS.mcp).toEqual([mcpCompletion]);
    expect(peerCompletionsFor("relay")).toEqual([]);
    expect(peerCompletionsFor("cli")).toEqual([]);
  });
});
