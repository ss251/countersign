/**
 * Every third-party dependency stays a bare import in the bundle, including its
 * subpaths: `viem` yields `viem` and `viem/*`, `@scope/name` yields both forms.
 */
export function externalPatterns(dependencies: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const name of dependencies) {
    if (name.startsWith("@countersign/")) {
      throw new Error(`workspace package ${name} must be inlined, not external`);
    }
    patterns.add(name);
    patterns.add(`${name}/*`);
  }
  return [...patterns].sort();
}
