import { PUBLISHABLE, type Publishable } from "./published.ts";

export type BuildArgs = {
  only: Publishable[] | undefined;
  require: Publishable[];
  out: string;
};

export type SmokeArgs = {
  dir: string;
};

function splitList(value: string, flag: string): Publishable[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) throw new Error(`${flag} needs at least one package name`);
  const seen = new Set<Publishable>();
  for (const name of names) {
    if (!(PUBLISHABLE as readonly string[]).includes(name)) {
      throw new Error(`unknown package in ${flag}: ${name} (known: ${PUBLISHABLE.join(", ")})`);
    }
    seen.add(name as Publishable);
  }
  return [...seen];
}

function takeValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function splitFlag(arg: string): { flag: string; value: string | undefined } {
  const equals = arg.indexOf("=");
  if (equals < 0) return { flag: arg, value: undefined };
  return { flag: arg.slice(0, equals), value: arg.slice(equals + 1) };
}

export function parseBuildArgs(argv: readonly string[]): BuildArgs {
  let only: Publishable[] | undefined;
  let require: Publishable[] = [];
  let out = ".release";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const { flag, value } = splitFlag(arg);
    if (flag !== "--only" && flag !== "--require" && flag !== "--out") {
      throw new Error(`unknown argument: ${flag}`);
    }
    const resolved = value ?? takeValue(argv, i, flag);
    if (value === undefined) i += 1;
    if (resolved.length === 0) throw new Error(`${flag} requires a value`);
    if (flag === "--out") out = resolved;
    else if (flag === "--only") only = splitList(resolved, flag);
    else require = splitList(resolved, flag);
  }

  return { only, require, out };
}

export function parseSmokeArgs(argv: readonly string[]): SmokeArgs {
  let dir = ".release";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    const { flag, value } = splitFlag(arg);
    if (flag !== "--dir") throw new Error(`unknown argument: ${flag}`);
    const resolved = value ?? takeValue(argv, i, flag);
    if (value === undefined) i += 1;
    if (resolved.length === 0) throw new Error("--dir requires a value");
    dir = resolved;
  }
  return { dir };
}

export type BuildPlan = {
  build: Publishable[];
  skipped: Publishable[];
};

/**
 * `--only` limits the candidates; `--require` adds a package that must exist.
 * A missing package is skipped unless it is required, in which case the whole
 * plan fails before anything is built.
 */
export function planBuild(input: {
  only: readonly Publishable[] | undefined;
  require: readonly Publishable[];
  exists: (short: Publishable) => boolean;
}): BuildPlan {
  const candidates = input.only === undefined ? [...PUBLISHABLE] : [...input.only];
  for (const name of input.require) {
    if (!candidates.includes(name)) candidates.push(name);
  }

  const required = new Set(input.require);
  const missing = candidates.filter((name) => !input.exists(name));
  const missingRequired = missing.filter((name) => required.has(name));
  if (missingRequired.length > 0) {
    throw new Error(
      `missing required package${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")} ` +
        `(${missingRequired.map((name) => `packages/${name}`).join(", ")} not found)`,
    );
  }

  return {
    build: candidates.filter((name) => input.exists(name)),
    skipped: missing,
  };
}
