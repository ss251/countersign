import { isRecord, type JsonObject } from "./json.ts";

/**
 * Per-package allowlist of `exports` keys that are published. A package with
 * no entry publishes everything its own `exports` and `bin` declare.
 */
export type PublishSurface = Readonly<Record<string, readonly string[] | undefined>>;

export const PUBLISH_SURFACE: PublishSurface = {
  relay: ["./paywall", "./pay-fetch", "./browser"],
};

export type ExtraEntry = {
  /** Repository-relative source path. */
  source: string;
  /** Staged target path, `dist/...js`. */
  target: string;
};

export type ExtraEntryTable = Readonly<Record<string, readonly ExtraEntry[] | undefined>>;

/**
 * Files that sit beside the main bundle but are not declared by `bin` or
 * `exports`. The runner starts its sandboxed child from `child-entry.js` next
 * to the running bundle.
 */
export const EXTRA_ENTRIES: ExtraEntryTable = {
  relay: [],
  mcp: [],
  cli: [{ source: "packages/runner/src/child-entry.ts", target: "dist/child-entry.js" }],
};

export type ExtraDependencyTable = Readonly<
  Record<string, Readonly<Record<string, string>> | undefined>
>;

/**
 * Published dependencies the import scanner cannot see, mapped to the short
 * workspace package that owns the version.
 */
export const EXTRA_DEPENDENCIES: ExtraDependencyTable = {
  relay: {},
  mcp: {},
  cli: { "@countersign-hub/mcp": "mcp" },
};

export function extraEntriesFor(short: string): readonly ExtraEntry[] {
  return EXTRA_ENTRIES[short] ?? [];
}

export function extraDependenciesFor(short: string): Readonly<Record<string, string>> {
  return EXTRA_DEPENDENCIES[short] ?? {};
}

export function publishAllowlist(
  short: string,
  surface: PublishSurface,
): readonly string[] | undefined {
  return surface[short];
}

/** The keys of an `exports` value: explicit subpaths, or the implicit root. */
export function exportKeys(exportsValue: unknown): string[] {
  if (exportsValue === undefined) return [];
  if (isRecord(exportsValue)) {
    const keys = Object.keys(exportsValue);
    if (keys.some((key) => key.startsWith("."))) {
      return keys.filter((key) => key === "." || key.startsWith("./"));
    }
  }
  return ["."];
}

/**
 * The `exports` value reduced to the publish surface. An allowlisted key that
 * the manifest does not export is an error: the surface must never promise
 * something that does not exist.
 */
export function publishExports(
  short: string,
  exportsValue: unknown,
  surface: PublishSurface,
): unknown {
  const allow = publishAllowlist(short, surface);
  if (allow === undefined) return exportsValue;

  const keys = exportKeys(exportsValue);
  for (const key of allow) {
    if (!keys.includes(key)) {
      throw new Error(
        `${short}: publish surface key ${JSON.stringify(key)} is not an export of ` +
          `packages/${short}/package.json`,
      );
    }
  }

  if (exportsValue === undefined) return undefined;
  if (isRecord(exportsValue) && Object.keys(exportsValue).some((key) => key.startsWith("."))) {
    const filtered: JsonObject = {};
    for (const key of allow) filtered[key] = exportsValue[key];
    return filtered;
  }
  return allow.includes(".") ? exportsValue : undefined;
}

export function omittedExportKeys(
  short: string,
  exportsValue: unknown,
  surface: PublishSurface = PUBLISH_SURFACE,
): string[] {
  const allow = publishAllowlist(short, surface);
  if (allow === undefined) return [];
  return exportKeys(exportsValue).filter((key) => !allow.includes(key));
}

/** One line for every manifest export that does not reach the published package. */
export function omittedExportLines(
  short: string,
  label: string,
  exportsValue: unknown,
  surface: PublishSurface = PUBLISH_SURFACE,
): string[] {
  return omittedExportKeys(short, exportsValue, surface).map(
    (key) =>
      `${short}: ${JSON.stringify(key)} not published (not on the publish surface: ` +
      `${label} exports it for the workspace)`,
  );
}
