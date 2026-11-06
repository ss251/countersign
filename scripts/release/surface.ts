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

export type GuardException = {
  /** Repository-relative source path the source map attributes the emitted hit to. */
  source: string;
  /** Node guard pattern, such as `Bun.`. */
  pattern: string;
  /** Non-empty sentence explaining why the hit cannot run on Node. */
  reason: string;
};

export type GuardExceptionTable = Readonly<
  Record<string, readonly GuardException[] | undefined>
>;

/**
 * Emitted Bun-only hits that a package can ship because Node cannot reach them.
 * An exception excuses a hit only when the source map attributes it to this
 * source and the pattern matches. Every entry must excuse one hit per build: a
 * stale entry is an error so the table cannot rot.
 */
export const GUARD_EXCEPTIONS: GuardExceptionTable = {
  relay: [],
  mcp: [],
  cli: [
    {
      source: "packages/runner/src/child.ts",
      pattern: "Bun.",
      reason:
        "runWithBun runs only when globalThis.Bun is defined; under Node defaultSpawner " +
        "returns node and node:child_process is used",
    },
    {
      source: "packages/buyer/src/openai/server.ts",
      pattern: "Bun.",
      reason:
        "started only by the buyer openai subcommand, which the countersign wrapper " +
        "does not expose",
    },
  ],
};

/** Checks every entry in the table; an empty source, pattern or reason throws. */
export function checkGuardExceptionTable(table: GuardExceptionTable = GUARD_EXCEPTIONS): void {
  for (const [short, exceptions] of Object.entries(table)) {
    for (const exception of exceptions ?? []) {
      if (exception.source.trim().length === 0) {
        throw new Error(`${short}: guard exception has an empty source`);
      }
      if (exception.pattern.trim().length === 0) {
        throw new Error(`${short}: guard exception has an empty pattern`);
      }
      if (exception.reason.trim().length === 0) {
        throw new Error(`${short}: guard exception has an empty reason`);
      }
    }
  }
}

export function guardExceptionsFor(
  short: string,
  table: GuardExceptionTable = GUARD_EXCEPTIONS,
): readonly GuardException[] {
  checkGuardExceptionTable(table);
  return table[short] ?? [];
}

/**
 * The exception excusing an emitted hit, or null. A hit with no attributed
 * source is never excused.
 */
export function findGuardException(
  exceptions: readonly GuardException[],
  source: string | null,
  pattern: string,
): GuardException | null {
  if (source === null) return null;
  return (
    exceptions.find(
      (exception) => exception.source === source && exception.pattern === pattern,
    ) ?? null
  );
}

/** One error line for every exception that excused nothing in this build. */
export function staleGuardExceptionLines(
  short: string,
  exceptions: readonly GuardException[],
  excused: readonly GuardException[],
): string[] {
  const used = new Set(excused);
  return exceptions
    .filter((exception) => !used.has(exception))
    .map(
      (exception) =>
        `stale guard exception for ${short}: ${exception.source} "${exception.pattern}"`,
    );
}

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
