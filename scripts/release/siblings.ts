import { PUBLISH_SCOPE } from "./published.ts";

export type Tarball = {
  /** Published package name from the tarball's own package.json. */
  name: string;
  /** Tarball path. */
  file: string;
};

export type SiblingPlan = {
  /** Tarballs to install in the same command as the tarball being checked. */
  siblings: Tarball[];
  /** Staged dependencies with no tarball in the directory, never skipped. */
  missing: string[];
};

/**
 * The sibling tarballs a tarball needs in the same `npm i`: every declared
 * `@countersign-hub/*` dependency whose tarball is in the directory. A
 * dependency with no tarball is reported as missing so the caller can fail
 * loudly instead of installing a tarball that cannot resolve it.
 */
export function requiredSiblings(input: {
  dependencies: Readonly<Record<string, string>> | undefined;
  available: readonly Tarball[];
  scope?: string;
}): SiblingPlan {
  const prefix = `${input.scope ?? PUBLISH_SCOPE}/`;
  const byName = new Map(input.available.map((tarball) => [tarball.name, tarball]));
  const siblings: Tarball[] = [];
  const missing: string[] = [];

  for (const name of Object.keys(input.dependencies ?? {})) {
    if (!name.startsWith(prefix)) continue;
    const sibling = byName.get(name);
    if (sibling === undefined) missing.push(name);
    else siblings.push(sibling);
  }

  siblings.sort((a, b) => a.name.localeCompare(b.name));
  missing.sort((a, b) => a.localeCompare(b));
  return { siblings, missing };
}

/** The short package name, `cli` for `@countersign-hub/cli`. */
export function tarballShort(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}
