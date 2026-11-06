import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

// cs-w1 adversarial test (B25; runs on cs/hd-20). A failing test here is a blocker.
// The hub's image runs `bun install --frozen-lockfile --production`, and for this lockfile bun 1.3.14
// links each workspace's own declared packages only (the isolated layout under node_modules/.bun).
// A package the hub's source imports without declaring it resolves on a hoisted install, then fails
// on the image's: index.ts loads rails.ts at boot, so the hub does not start at all.

const hubRoot = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(hubRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
  }
  return out;
}

/** Module specifiers in static imports and re-exports, side-effect imports, and dynamic imports. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function isBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith("node:") ||
    specifier === "bun" ||
    specifier.startsWith("bun:") ||
    builtinModules.includes(packageOf(specifier))
  );
}

describe("W1 B25: the hub imports only packages it declares", () => {
  test("every package apps/hub/src imports is in apps/hub/package.json", () => {
    const missing: string[] = [];
    for (const file of sources(join(hubRoot, "src"))) {
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        if (specifier.startsWith(".") || specifier.startsWith("/") || isBuiltin(specifier)) continue;
        const name = packageOf(specifier);
        if (!declared.has(name)) missing.push(`${file.slice(hubRoot.length + 1)} imports ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
