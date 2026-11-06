import { builtinModules } from "node:module";

const COUNTED_KINDS = new Set(["import-statement", "dynamic-import", "require-call"]);
const BUILTINS = new Set(builtinModules);
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export type ImportedPackage = {
  package: string;
  file: string;
};

/**
 * The npm package a bare specifier resolves to: `viem/chains` is `viem`,
 * `@scope/pkg/sub` is `@scope/pkg`, `ajv/dist/2020.js` is `ajv`. Node builtins,
 * `node:` specifiers, relative paths, package imports (`#x`) and other URL
 * schemes are not packages.
 */
export function packageName(specifier: string): string | null {
  const path = specifier.trim();
  if (path.length === 0) return null;
  if (path.startsWith("node:") || BUILTINS.has(path)) return null;
  if (path.startsWith(".") || path.startsWith("/") || path.startsWith("#")) return null;
  if (SCHEME.test(path)) return null;

  const parts = path.split("/");
  const head = parts[0];
  if (head === undefined || head.length === 0) return null;
  if (head.startsWith("@")) {
    const scope = parts[1];
    if (scope === undefined || scope.length === 0) return null;
    return `${head}/${scope}`;
  }
  return head;
}

/**
 * Every package a JavaScript file imports, from static and side-effect imports,
 * dynamic imports and require calls. Bun's scanner parses the code, so a string
 * literal that merely contains `from "x"` is not an import.
 */
export function scanImportPackages(code: string): string[] {
  const packages = new Set<string>();
  const transpiler = new Bun.Transpiler({ loader: "js" });
  for (const imported of transpiler.scanImports(code)) {
    if (!COUNTED_KINDS.has(imported.kind)) continue;
    const name = packageName(imported.path);
    if (name !== null) packages.add(name);
  }
  return [...packages].sort((a, b) => a.localeCompare(b));
}

export type DependencySelection = {
  dependencies: Record<string, string>;
  imported: string[];
};

/**
 * Keep only the union members the emitted bundles import, taking each range
 * from the union. An import with no declared range fails with the package and
 * every emitted file that imports it: a published tarball must never fail with
 * "cannot find package" at runtime.
 */
export function selectDependencies(
  imports: readonly ImportedPackage[],
  declared: Record<string, string>,
): DependencySelection {
  const files = new Map<string, Set<string>>();
  for (const imported of imports) {
    const seen = files.get(imported.package) ?? new Set<string>();
    seen.add(imported.file);
    files.set(imported.package, seen);
  }

  const imported = [...files.keys()].sort((a, b) => a.localeCompare(b));
  const dependencies: Record<string, string> = {};
  for (const name of imported) {
    const spec = declared[name];
    if (spec === undefined) {
      const where = [...(files.get(name) ?? [])].sort((a, b) => a.localeCompare(b)).join(", ");
      throw new Error(
        `undeclared dependency ${name} imported by ${where}; add it to a repository manifest`,
      );
    }
    dependencies[name] = spec;
  }
  return { dependencies, imported };
}
