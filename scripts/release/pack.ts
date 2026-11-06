import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_BASE = "https://github.com/ss251/countersign/releases/download/v0.1.0";
const DEFAULT_OUT = ".release";
const PACKAGES = ["core", "rail", "relay"] as const;
const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

const ROOT = resolve(import.meta.dir, "..", "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function spawnOrFail(cmd: string[], cwd: string): string {
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr.length > 0 ? stderr : `${cmd.join(" ")} exited ${result.exitCode}`);
  }
  return result.stdout.toString();
}

function parseArgs(argv: readonly string[]): { base: string; out: string } {
  let base = DEFAULT_BASE;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--base" || arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--base") base = value;
      else out = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (base.length === 0) throw new Error("--base requires a url");
  if (out.length === 0) throw new Error("--out requires a directory");
  return { base, out };
}

function countersignName(key: string): string | null {
  const name = /^@countersign\/([a-z0-9-]+)$/.exec(key)?.[1];
  return name ?? null;
}

function versionOf(name: string): string {
  const file = join(ROOT, "packages", name, "package.json");
  if (!existsSync(file)) throw new Error(`no repository package.json for @countersign/${name}`);
  const parsed = readJson(file);
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`packages/${name}/package.json has no version`);
  }
  return parsed.version;
}

function tarballUrl(base: string, name: string, version: string): string {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${root}/countersign-${name}-${version}.tgz`;
}

function assertNoWorkspace(manifest: Record<string, unknown>): void {
  for (const section of DEP_SECTIONS) {
    const value = manifest[section];
    if (value === undefined) continue;
    if (!isRecord(value)) throw new Error(`${section} is not an object`);
    for (const [key, spec] of Object.entries(value)) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        throw new Error(`${section}.${key} still starts with workspace:`);
      }
    }
  }
}

function rewriteDependencies(manifest: Record<string, unknown>, base: string): Record<string, unknown> {
  const deps = manifest.dependencies;
  if (deps === undefined) return {};
  if (!isRecord(deps)) throw new Error("dependencies is not an object");
  for (const [key, spec] of Object.entries(deps)) {
    if (typeof spec !== "string") throw new Error(`dependencies.${key} is not a string`);
    const name = countersignName(key);
    if (name === null) continue;
    deps[key] = tarballUrl(base, name, versionOf(name));
  }
  return deps;
}

function packedTarball(stdout: string, outDir: string, name: string, version: string): string {
  const expected = join(outDir, `countersign-${name}-${version}.tgz`);
  if (existsSync(expected)) return expected;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.endsWith(".tgz")) continue;
    const candidate = isAbsolute(trimmed) ? trimmed : join(outDir, trimmed);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`bun pm pack produced no tarball for @countersign/${name}`);
}

function rewriteTarball(tarball: string, base: string): Record<string, unknown> {
  const tmp = mkdtempSync(join(tmpdir(), "countersign-pack-"));
  try {
    spawnOrFail(["tar", "-xzf", tarball, "-C", tmp], ROOT);
    const manifestPath = join(tmp, "package", "package.json");
    const parsed = readJson(manifestPath);
    if (!isRecord(parsed)) throw new Error(`${tarball} package.json is not an object`);
    const dependencies = rewriteDependencies(parsed, base);
    assertNoWorkspace(parsed);
    writeFileSync(manifestPath, `${JSON.stringify(parsed, null, 2)}\n`);
    spawnOrFail(["tar", "-czf", tarball, "-C", tmp, "package"], ROOT);
    return dependencies;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });
  for (const name of PACKAGES) {
    const version = versionOf(name);
    const stdout = spawnOrFail(
      [process.execPath, "pm", "pack", "--destination", outDir],
      join(ROOT, "packages", name),
    );
    const tarball = packedTarball(stdout, outDir, name, version);
    const dependencies = rewriteTarball(tarball, args.base);
    process.stdout.write(`${tarball}\n${JSON.stringify(dependencies, null, 2)}\n`);
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}
