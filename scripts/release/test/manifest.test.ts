import { describe, expect, test } from "bun:test";
import { selectDependencies } from "../imports.ts";
import {
  dependencyUnion,
  entrySources,
  extraDependencyRanges,
  sourceTargetMap,
  stagedManifest,
  type PackageManifest,
} from "../manifest.ts";
import { PUBLISH_SCOPE } from "../published.ts";

function manifests(packages: Record<string, PackageManifest>) {
  return (short: string) => {
    const manifest = packages[short];
    if (manifest === undefined) throw new Error(`missing packages/${short}`);
    return { label: `packages/${short}/package.json`, manifest };
  };
}

describe("the third-party dependency union", () => {
  test("a diamond across workspace packages keeps one range per dependency", () => {
    const read = manifests({
      root: {
        dependencies: {
          "@countersign/left": "workspace:*",
          "@countersign/right": "workspace:*",
        },
      },
      left: { dependencies: { viem: "^2.57.16", ajv: "^8.20.0" } },
      right: {
        dependencies: {
          viem: "^2.57.16",
          "@countersign/shared": "workspace:*",
        },
      },
      shared: { dependencies: { viem: "^2.57.16", hono: "^4.13.16" } },
    });

    expect(dependencyUnion("root", read)).toEqual({
      ajv: "^8.20.0",
      hono: "^4.13.16",
      viem: "^2.57.16",
    });
  });

  test("a conflicting range throws with both manifests named", () => {
    const read = manifests({
      root: {
        dependencies: { "@countersign/left": "workspace:*", "@countersign/right": "workspace:*" },
      },
      left: { dependencies: { viem: "^2.57.16" } },
      right: { dependencies: { viem: "1.0.0" } },
    });

    expect(() => dependencyUnion("root", read)).toThrow(/viem/);
    let message = "";
    try {
      dependencyUnion("root", read);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("packages/left/package.json");
    expect(message).toContain("packages/right/package.json");
    expect(message).toContain("^2.57.16");
    expect(message).toContain("1.0.0");
  });

  test("a workspace: specifier on a third-party dependency throws", () => {
    const read = manifests({
      root: { dependencies: { "left-pad": "workspace:*" } },
    });
    expect(() => dependencyUnion("root", read)).toThrow(/left-pad.*workspace:/);
  });

  test("workspace packages are followed and removed from the union", () => {
    const read = manifests({
      root: { dependencies: { "@countersign/core": "workspace:*" } },
      core: { dependencies: { viem: "^2.57.16" } },
    });
    expect(dependencyUnion("root", read)).toEqual({ viem: "^2.57.16" });
  });
});

describe("entries and staged manifest", () => {
  const manifest: PackageManifest = {
    name: "@countersign/relay",
    version: "0.1.0",
    bin: { countersign: "./src/cli.ts" },
    exports: {
      ".": "./src/index.ts",
      "./paywall": { import: "./src/paywall.ts", types: "./src/paywall.ts" },
      "./package.json": "./package.json",
    },
  };

  test("entry sources come from exports and bin, deduplicated", () => {
    expect(entrySources(manifest)).toEqual([
      "./src/index.ts",
      "./src/paywall.ts",
      "./src/cli.ts",
    ]);
  });

  test("targets are dist javascript paths", () => {
    expect(sourceTargetMap(entrySources(manifest))).toEqual({
      "./src/cli.ts": "./dist/cli.js",
      "./src/index.ts": "./dist/index.js",
      "./src/paywall.ts": "./dist/paywall.js",
    });
  });

  test("the staged manifest is public, Node 20, and has no private field", () => {
    const staged = stagedManifest({
      short: "relay",
      manifest,
      dependencies: { viem: "^2.57.16", hono: "^4.13.16" },
      targets: sourceTargetMap(entrySources(manifest)),
    });

    expect(staged.name).toBe(`${PUBLISH_SCOPE}/relay`);
    expect(staged.version).toBe("0.1.0");
    expect(staged.type).toBe("module");
    expect(staged.license).toBe("MIT");
    expect(staged.publishConfig).toEqual({ access: "public" });
    expect(staged.engines).toEqual({ node: ">=20" });
    expect(staged.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(staged.repository).toEqual({
      type: "git",
      url: "git+https://github.com/ss251/countersign.git",
      directory: "packages/relay",
    });
    expect(staged.homepage).toBe("https://github.com/ss251/countersign/tree/main/packages/relay#readme");
    expect(staged.bugs).toEqual({ url: "https://github.com/ss251/countersign/issues" });
    expect(Array.isArray(staged.keywords)).toBe(true);
    expect(staged.private).toBeUndefined();
    expect(staged.dependencies).toEqual({ hono: "^4.13.16", viem: "^2.57.16" });
    expect(staged.bin).toEqual({ countersign: "./dist/cli.js" });
    expect(staged.exports).toEqual({
      ".": "./dist/index.js",
      "./paywall": { import: "./dist/paywall.js", types: "./dist/paywall.js" },
      "./package.json": "./package.json",
    });
  });

  test("one scope constant renames every staged package", () => {
    const staged = stagedManifest({
      short: "relay",
      manifest,
      dependencies: {},
      targets: sourceTargetMap(entrySources(manifest)),
      scope: "@other-scope",
    });
    expect(staged.name).toBe("@other-scope/relay");
  });

  test("the staged manifest takes the source package's Node floor", () => {
    const staged = stagedManifest({
      short: "cli",
      manifest: { ...manifest, engines: { node: ">=22" } },
      dependencies: {},
      targets: sourceTargetMap(entrySources(manifest)),
    });
    expect(staged.engines).toEqual({ node: ">=22" });
  });

  test("a package without bin has no bin field", () => {
    const staged = stagedManifest({
      short: "mcp",
      manifest: { version: "0.1.0", exports: { ".": "./src/index.ts" } },
      dependencies: {},
      targets: { "./src/index.ts": "./dist/index.js" },
    });
    expect(staged.bin).toBeUndefined();
  });

  test("a workspace dependency can never reach the staged manifest", () => {
    expect(() =>
      stagedManifest({
        short: "relay",
        manifest,
        dependencies: { "@countersign/core": "workspace:*" },
        targets: sourceTargetMap(entrySources(manifest)),
      }),
    ).toThrow(/workspace/);
  });
});

describe("extra dependencies", () => {
  const read = (workspaces: Record<string, string>) => (short: string) => {
    const version = workspaces[short];
    if (version === undefined) return null;
    return { label: `packages/${short}/package.json`, manifest: { version } };
  };

  test("a published extra dependency takes ^ plus the workspace version", () => {
    const plan = extraDependencyRanges(
      "cli",
      { "@countersign-hub/mcp": "mcp" },
      read({ mcp: "0.1.0" }),
    );
    expect(plan.dependencies).toEqual({ "@countersign-hub/mcp": "^0.1.0" });
    expect(plan.skipped).toEqual([]);
  });

  test("an absent workspace package is skipped with one loud line", () => {
    const plan = extraDependencyRanges("cli", { "@countersign-hub/mcp": "mcp" }, () => null);
    expect(plan.dependencies).toEqual({});
    expect(plan.skipped).toEqual([
      "cli: extra dependency @countersign-hub/mcp skipped (packages/mcp not found)",
    ]);
  });

  test("an extra dependency is added after the scan and is never pruned", () => {
    const scanned = selectDependencies([], {});
    const plan = extraDependencyRanges(
      "cli",
      { "@countersign-hub/mcp": "mcp" },
      read({ mcp: "0.1.0" }),
    );
    expect({ ...scanned.dependencies, ...plan.dependencies }).toEqual({
      "@countersign-hub/mcp": "^0.1.0",
    });
  });
});
