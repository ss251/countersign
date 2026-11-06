/**
 * A bin file must start with exactly one `#!/usr/bin/env node` line. Bun's
 * shebang is replaced, and a missing one is added; any extra leading shebang
 * lines are dropped.
 */
export function withNodeShebang(source: string): string {
  const lines = source.split("\n");
  let first = 0;
  while (first < lines.length && lines[first]?.startsWith("#!") === true) first += 1;
  return ["#!/usr/bin/env node", ...lines.slice(first)].join("\n");
}
