/**
 * Bun bakes the absolute source directory of a bundled third-party module into
 * the bundle as `var __dirname = "<repo>/node_modules/<pkg>"` (and `__filename`).
 * That is the builder's checkout path: it points nowhere on a user's machine
 * and leaks the builder's home directory. These constants, and only these, are
 * rewritten to the part below the repository root (`/node_modules/<pkg>`).
 * Any other occurrence of the repository root is left for the leak check to
 * fail on.
 */
export type ScrubResult = { source: string; count: number };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function scrubBuildPaths(source: string, rootDir: string): ScrubResult {
  const root = rootDir.replace(/\/+$/, "");
  if (root.length === 0) return { source, count: 0 };
  const pattern = new RegExp(
    `(var __(?:dirname|filename) = ")${escapeRegExp(root)}(/node_modules/[^"\\n]*")`,
    "g",
  );
  let count = 0;
  const scrubbed = source.replace(pattern, (_match, head: string, tail: string) => {
    count += 1;
    return `${head}${tail}`;
  });
  return { source: scrubbed, count };
}
