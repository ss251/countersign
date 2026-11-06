import { nodeEngine } from "./engines.ts";
import { isRecord, type JsonObject } from "./json.ts";
import { publishedName } from "./published.ts";
import {
  extraEntriesFor,
  publishExports,
  type PublishSurface,
} from "./surface.ts";

export type PackageManifest = JsonObject;

export type ManifestSource = {
  label: string;
  manifest: PackageManifest;
};

export type ManifestReader = (short: string) => ManifestSource;

const WORKSPACE_PACKAGE = /^@countersign\/([a-z0-9][a-z0-9-]*)$/;
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;

export function workspaceShort(name: string): string | null {
  return WORKSPACE_PACKAGE.exec(name)?.[1] ?? null;
}

export function normalizeSource(spec: string): string {
  const trimmed = spec.trim();
  if (trimmed.length === 0) throw new Error("empty entry path");
  if (trimmed.startsWith("/")) throw new Error(`entry path must be relative: ${spec}`);
  return trimmed.startsWith("./") ? trimmed : `./${trimmed}`;
}

function sortedDependencies(dependencies: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The third-party dependency union of a package and every @countersign/*
 * package it depends on, recursively. Workspace names are removed, conflicting
 * ranges fail with both manifest labels, and a workspace: specifier on a
 * third-party name fails because it can never be installed by npm.
 */
export function dependencyUnion(
  roots: string | readonly string[],
  read: ManifestReader,
): Record<string, string> {
  const rootList = typeof roots === "string" ? [roots] : [...roots];
  const ranges = new Map<string, { spec: string; label: string }>();
  const visited = new Set<string>();

  function visit(short: string): void {
    if (visited.has(short)) return;
    visited.add(short);

    const { label, manifest } = read(short);
    const dependencies = manifest.dependencies;
    if (dependencies === undefined) return;
    if (!isRecord(dependencies)) throw new Error(`${label} dependencies is not an object`);

    for (const [name, rawSpec] of Object.entries(dependencies)) {
      if (typeof rawSpec !== "string") throw new Error(`${label} dependencies.${name} is not a string`);
      const workspace = workspaceShort(name);
      if (workspace !== null) {
        visit(workspace);
        continue;
      }
      if (rawSpec.startsWith("workspace:")) {
        throw new Error(`${label} dependencies.${name} uses ${rawSpec}; workspace: cannot be published`);
      }

      const existing = ranges.get(name);
      if (existing !== undefined && existing.spec !== rawSpec) {
        throw new Error(
          `conflicting version ranges for ${name}: ${existing.spec} in ${existing.label} ` +
            `vs ${rawSpec} in ${label}`,
        );
      }
      if (existing === undefined) ranges.set(name, { spec: rawSpec, label });
    }
  }

  for (const short of rootList) visit(short);
  return sortedDependencies(Object.fromEntries([...ranges].map(([name, entry]) => [name, entry.spec])));
}

export function binSources(bin: unknown): string[] {
  if (bin === undefined) return [];
  if (typeof bin === "string") return [normalizeSource(bin)];
  if (!isRecord(bin)) throw new Error("bin must be a string or an object");
  return Object.entries(bin).map(([name, value]) => {
    if (typeof value !== "string") throw new Error(`bin.${name} is not a string`);
    return normalizeSource(value);
  });
}

function exportSources(exportsValue: unknown): string[] {
  const sources: string[] = [];

  function visit(value: unknown): void {
    if (typeof value === "string") {
      if (value.startsWith("./") && SOURCE_EXTENSION.test(value)) sources.push(normalizeSource(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (isRecord(value)) {
      for (const entry of Object.values(value)) visit(entry);
      return;
    }
    throw new Error(`exports contains a ${typeof value} value`);
  }

  if (exportsValue !== undefined) visit(exportsValue);
  return sources;
}

export type EntryOptions = {
  short?: string;
  surface?: PublishSurface;
};

/** Every source file referenced by the package's own bin and published exports values. */
export function entrySources(
  manifest: PackageManifest,
  options: EntryOptions = {},
): string[] {
  const exportsValue =
    options.short === undefined || options.surface === undefined
      ? manifest.exports
      : publishExports(options.short, manifest.exports, options.surface);
  const seen = new Set<string>();
  for (const source of [...exportSources(exportsValue), ...binSources(manifest.bin)]) {
    seen.add(source);
  }
  return [...seen];
}

export function distTarget(source: string): string {
  const normalized = normalizeSource(source);
  const relativePath = normalized.slice(2);
  if (relativePath.startsWith("../") || relativePath.includes("/../")) {
    throw new Error(`entry escapes the package: ${source}`);
  }
  const underSrc = relativePath.startsWith("src/") ? relativePath.slice(4) : relativePath;
  return `./dist/${underSrc.replace(SOURCE_EXTENSION, ".js")}`;
}

/** Maps each source entry ("./src/index.ts") to its built path ("./dist/index.js"). */
export function sourceTargetMap(sources: readonly string[]): Record<string, string> {
  const byTarget = new Map<string, string>();
  for (const raw of sources) {
    const source = normalizeSource(raw);
    const target = distTarget(source);
    const existing = byTarget.get(target);
    if (existing !== undefined && existing !== source) {
      throw new Error(`both ${existing} and ${source} build to ${target}`);
    }
    byTarget.set(target, source);
  }
  return Object.fromEntries(
    [...byTarget.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([target, source]) => [source, target]),
  );
}

export type BundleEntry = {
  /** Repository-relative source path. */
  source: string;
  /** Staged path inside the package, `./dist/...`. */
  target: string;
  /** True for a surface extra that bin and exports never declare. */
  extra: boolean;
};

function repositorySource(source: string): string {
  const normalized = normalizeSource(source).slice(2);
  if (normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`entry escapes the repository: ${source}`);
  }
  return normalized;
}

function extraTarget(target: string): string {
  const normalized = target.trim().replace(/^\.\//, "");
  if (
    !normalized.startsWith("dist/") ||
    !normalized.endsWith(".js") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`extra entry target must be a dist javascript path: ${target}`);
  }
  return normalized;
}

/**
 * Every file the build bundles for a package: the manifest's bin and published
 * exports, plus the surface extras. Extras never reach `bin` or `exports`.
 */
export function bundleEntries(
  short: string,
  manifest: PackageManifest,
  options: EntryOptions = {},
): BundleEntry[] {
  const main = entrySources(manifest, options).map((source) => ({
    source: repositorySource(`packages/${short}/${normalizeSource(source).slice(2)}`),
    target: distTarget(source),
    extra: false,
  }));
  const extras = extraEntriesFor(short).map((entry) => ({
    source: repositorySource(entry.source),
    target: extraTarget(entry.target),
    extra: true,
  }));

  const byTarget = new Map(main.map((entry) => [entry.target, entry.source]));
  for (const extra of extras) {
    const existing = byTarget.get(extra.target);
    if (existing !== undefined) {
      throw new Error(`both ${existing} and ${extra.source} build to ${extra.target}`);
    }
    byTarget.set(extra.target, extra.source);
  }
  return [...main, ...extras];
}

export type ExtraDependencyPlan = {
  dependencies: Record<string, string>;
  /** One line per skipped extra dependency, ready to print. */
  skipped: string[];
};

/**
 * The extra dependencies of a package, with each range taken from the version
 * of its short workspace package. A missing workspace package is skipped with
 * one line instead of failing the build.
 */
export function extraDependencyRanges(
  short: string,
  extra: Readonly<Record<string, string>>,
  read: (workspace: string) => ManifestSource | null,
): ExtraDependencyPlan {
  const dependencies: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [name, workspace] of Object.entries(extra)) {
    const source = read(workspace);
    if (source === null) {
      skipped.push(`${short}: extra dependency ${name} skipped (packages/${workspace} not found)`);
      continue;
    }
    const version = source.manifest.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`${source.label} has no version for ${short} extra dependency ${name}`);
    }
    dependencies[name] = `^${version}`;
  }
  return { dependencies: sortedDependencies(dependencies), skipped };
}

function rewriteValue(
  value: unknown,
  targets: Record<string, string>,
  where: string,
): unknown {
  if (typeof value === "string") {
    const normalized = value.startsWith("./") ? value : `./${value.replace(/^\/+/, "")}`;
    const target = targets[normalized];
    if (target !== undefined) return target;
    if (SOURCE_EXTENSION.test(value)) {
      throw new Error(`${where} points at ${value}, which is not a bundled entry`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteValue(entry, targets, where));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteValue(entry, targets, `${where}.${key}`)]),
    );
  }
  throw new Error(`${where} contains a ${typeof value} value`);
}

function rewriteBin(bin: unknown, targets: Record<string, string>): unknown {
  if (typeof bin === "string") return rewriteValue(bin, targets, "bin");
  if (isRecord(bin)) {
    return Object.fromEntries(
      Object.entries(bin).map(([name, value]) => [name, rewriteValue(value, targets, `bin.${name}`)]),
    );
  }
  throw new Error("bin must be a string or an object");
}

export type StagedManifestInput = {
  short: string;
  manifest: PackageManifest;
  dependencies: Record<string, string>;
  targets: Record<string, string>;
  scope?: string;
  surface?: PublishSurface;
};

/**
 * The generated package.json that goes into the tarball. The repository
 * manifest is only read: name, version, bin and exports are rewritten for the
 * published package, and no workspace or private field survives.
 */
export function stagedManifest(input: StagedManifestInput): JsonObject {
  const { short, manifest, dependencies, targets, scope, surface } = input;
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`packages/${short}/package.json has no version`);
  }

  const publishedDependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(dependencies)) {
    if (workspaceShort(name) !== null) {
      throw new Error(`staged dependencies still contain workspace package ${name}`);
    }
    if (typeof spec !== "string" || spec.startsWith("workspace:")) {
      throw new Error(`staged dependencies.${name} is not a publishable range: ${String(spec)}`);
    }
    publishedDependencies[name] = spec;
  }

  const staged: JsonObject = {
    name: publishedName(short, scope),
    version: manifest.version,
    type: "module",
    license: "MIT",
    publishConfig: { access: "public" },
    engines: { node: nodeEngine(manifest) },
    files: ["dist"],
    dependencies: sortedDependencies(publishedDependencies),
  };
  if (manifest.bin !== undefined) staged.bin = rewriteBin(manifest.bin, targets);
  const exportsValue =
    surface === undefined ? manifest.exports : publishExports(short, manifest.exports, surface);
  if (exportsValue !== undefined) {
    staged.exports = rewriteValue(exportsValue, targets, "exports");
  }
  return staged;
}
