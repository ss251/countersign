import { describe, expect, test } from "bun:test";
import {
  entrySources,
  sourceTargetMap,
  stagedManifest,
  type PackageManifest,
} from "../manifest.ts";
import {
  PUBLISH_SURFACE,
  exportKeys,
  omittedExportLines,
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
});
