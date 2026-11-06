import { isRecord, type JsonObject } from "./json.ts";
import { publishedName } from "./published.ts";

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

/** Every source file referenced by the package's own bin and exports values. */
export function entrySources(manifest: PackageManifest): string[] {
  const seen = new Set<string>();
  for (const source of [...exportSources(manifest.exports), ...binSources(manifest.bin)]) {
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
};

/**
 * The generated package.json that goes into the tarball. The repository
 * manifest is only read: name, version, bin and exports are rewritten for the
 * published package, and no workspace or private field survives.
 */
export function stagedManifest(input: StagedManifestInput): JsonObject {
  const { short, manifest, dependencies, targets, scope } = input;
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
    engines: { node: ">=20" },
    files: ["dist"],
    dependencies: sortedDependencies(publishedDependencies),
  };
  if (manifest.bin !== undefined) staged.bin = rewriteBin(manifest.bin, targets);
  if (manifest.exports !== undefined) {
    staged.exports = rewriteValue(manifest.exports, targets, "exports");
  }
  return staged;
}
