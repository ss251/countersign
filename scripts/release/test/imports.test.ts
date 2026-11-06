import { describe, expect, test } from "bun:test";
import {
  packageName,
  scanImportPackages,
  selectDependencies,
  stripShebang,
} from "../imports.ts";
import { dependencyUnion, type PackageManifest } from "../manifest.ts";

describe("the bundle import scanner", () => {
  test("counts a static import", () => {
    expect(scanImportPackages('import { createPublicClient } from "viem";')).toEqual(["viem"]);
  });

  test("scans a bundle that starts with a shebang", () => {
    const fixture = '#!/usr/bin/env node\nimport { createPublicClient } from "viem";';
    expect(scanImportPackages(fixture)).toEqual(["viem"]);
  });

  test("stripShebang removes only the leading line", () => {
    expect(stripShebang('#!/usr/bin/env node\nimport "viem";')).toBe('import "viem";');
    expect(stripShebang('import "viem";')).toBe('import "viem";');
  });

  test("counts a side-effect import", () => {
    expect(scanImportPackages('import "hono";')).toEqual(["hono"]);
  });

  test("counts a dynamic import", () => {
    expect(scanImportPackages('const ajv = await import("ajv/dist/2020.js");')).toEqual(["ajv"]);
  });

  test("counts a require call", () => {
    expect(scanImportPackages('const stripe = require("stripe");')).toEqual(["stripe"]);
  });

  test("ignores node: specifiers and Node builtins", () => {
    expect(scanImportPackages('import fs from "node:fs";\nimport path from "path";')).toEqual([]);
  });

  test("does not count a string literal that contains from", () => {
    expect(scanImportPackages('const note = \'from "left-pad"\';')).toEqual([]);
  });

  test("reduces every subpath to its package name", () => {
    const code = [
      'import "viem/chains";',
      'import "viem/accounts";',
      'import "viem/ens";',
      'import "ajv/dist/2020.js";',
      'export { x } from "@scope/pkg/sub";',
    ].join("\n");
    expect(scanImportPackages(code)).toEqual(["@scope/pkg", "ajv", "viem"]);
  });

  test("one specifier becomes one package name", () => {
    expect(packageName("viem/chains")).toBe("viem");
    expect(packageName("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageName("ajv/dist/2020.js")).toBe("ajv");
    expect(packageName("node:crypto")).toBeNull();
    expect(packageName("crypto")).toBeNull();
    expect(packageName("./local.js")).toBeNull();
  });
});

describe("the staged dependency selection", () => {
  const declared = {
    ajv: "^8.20.0",
    hono: "^4.13.16",
    stripe: "23.1.0",
    viem: "^2.57.16",
  };

  test("unused declared dependencies are dropped and keys sort", () => {
    const selected = selectDependencies(
      [
        { package: "viem", file: ".release/stage/relay/dist/paywall.js" },
        { package: "ajv", file: ".release/stage/relay/dist/pay-fetch.js" },
        { package: "viem", file: ".release/stage/relay/dist/pay-fetch.js" },
      ],
      declared,
    );
    expect(selected.imported).toEqual(["ajv", "viem"]);
    expect(Object.keys(selected.dependencies)).toEqual(["ajv", "viem"]);
    expect(selected.dependencies).toEqual({ ajv: "^8.20.0", viem: "^2.57.16" });
  });

  test("a bundle that imports an undeclared package fails with package and file", () => {
    expect(() =>
      selectDependencies(
        [{ package: "left-pad", file: ".release/stage/relay/dist/index.js" }],
        declared,
      ),
    ).toThrow(/left-pad.*\.release\/stage\/relay\/dist\/index\.js/);
  });

  test("a conflicting range still throws with both manifests named", () => {
    const manifests: Record<string, PackageManifest> = {
      root: {
        dependencies: {
          "@countersign/left": "workspace:*",
          "@countersign/right": "workspace:*",
        },
      },
      left: { dependencies: { viem: "^2.57.16" } },
      right: { dependencies: { viem: "1.0.0" } },
    };
    const read = (short: string) => {
      const manifest = manifests[short];
      if (manifest === undefined) throw new Error(`missing packages/${short}`);
      return { label: `packages/${short}/package.json`, manifest };
    };

    expect(() => dependencyUnion("root", read)).toThrow(/conflicting version ranges for viem/);
    let message = "";
    try {
      dependencyUnion("root", read);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("packages/left/package.json");
    expect(message).toContain("packages/right/package.json");
  });
});
