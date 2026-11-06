import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseSmokeArgs } from "./args.ts";
import { isRecord } from "./json.ts";
import { PUBLISH_SCOPE, publishedName } from "./published.ts";

const ROOT = resolve(import.meta.dir, "..", "..");

type Run = {
  code: number;
  stdout: string;
  stderr: string;
};

let failed = false;

function run(cmd: string[], cwd: string): Run {
  const result = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, COPYFILE_DISABLE: "1", NO_COLOR: "1" },
  });
  return {
    code: result.exitCode ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function check(label: string, ok: boolean, detail = ""): void {
  const clean = detail.replace(/\s+/g, " ").trim();
  const suffix = clean.length > 0 ? `: ${clean.slice(0, 400)}` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${suffix}`);
  if (!ok) failed = true;
}

function output(result: Run): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function binEntries(manifestName: string, bin: unknown): [string, string][] {
  if (bin === undefined) return [];
  if (typeof bin === "string") {
    const short = manifestName.split("/").pop() ?? manifestName;
    return [[short, bin]];
  }
  if (!isRecord(bin)) return [];
  return Object.entries(bin).flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as [string, string]] : [],
  );
}

function exportSubpaths(exportsValue: unknown): string[] {
  if (!isRecord(exportsValue)) return [];
  const keys = Object.keys(exportsValue);
  if (keys.some((key) => key.startsWith("."))) {
    return keys.filter((key) => key === "." || key.startsWith("./"));
  }
  return ["."];
}

function specifier(name: string, subpath: string): string {
  if (subpath === ".") return name;
  return `${name}/${subpath.slice(2)}`;
}

function installedPackage(root: string): { name: string; manifest: Record<string, unknown> } | null {
  const scopeDir = join(root, "node_modules", PUBLISH_SCOPE);
  if (!existsSync(scopeDir)) return null;
  const packages = readdirSync(scopeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const short of packages) {
    const file = join(scopeDir, short, "package.json");
    if (!existsSync(file)) continue;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed) || typeof parsed.name !== "string") continue;
    return { name: parsed.name, manifest: parsed };
  }
  return null;
}

function nodeMajor(): number | null {
  const version = run(["node", "--version"], ROOT);
  const text = `${version.stdout}${version.stderr}`.trim();
  console.log(`node --version: ${text}`);
  const major = /^v(\d+)\./.exec(text)?.[1];
  return major === undefined ? null : Number(major);
}

function smokeTarball(tarball: string): void {
  const fallback = basename(tarball, ".tgz");
  const work = mkdtempSync(join(tmpdir(), "countersign-smoke-"));
  try {
    const init = run(["npm", "init", "-y"], work);
    check(`${fallback} init`, init.code === 0, output(init));

    const install = run(["npm", "i", "--no-audit", "--no-fund", tarball], work);
    check(`${fallback} install`, install.code === 0, output(install));
    if (install.code !== 0) return;

    const installed = installedPackage(work);
    if (installed === null) {
      check(`${fallback} package.json`, false, "no installed package under node_modules/@countersign-hub");
      return;
    }
    const short = installed.name.split("/").pop() ?? fallback;
    const expectedName = publishedName(short);
    check(
      `${short} published name`,
      installed.name === expectedName,
      `${installed.name} (expected ${expectedName})`,
    );

    for (const [name] of binEntries(installed.name, installed.manifest.bin)) {
      const result = run(["npx", name, "--help"], work);
      check(`${short} bin ${name} --help`, result.code === 0 && output(result).length > 0, output(result));
    }

    for (const subpath of exportSubpaths(installed.manifest.exports)) {
      const spec = specifier(installed.name, subpath);
      if (spec.includes("*")) {
        check(`${short} export ${spec}`, false, "wildcard export needs a concrete subpath");
        continue;
      }
      const result = run(
        ["node", "--input-type=module", "-e", `await import(${JSON.stringify(spec)});`],
        work,
      );
      check(`${short} export ${spec}`, result.code === 0, output(result));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const major = nodeMajor();
  if (major === null || major < 20) {
    console.error("smoke requires Node 20 or newer on PATH");
    process.exit(1);
  }

  const args = parseSmokeArgs(process.argv.slice(2));
  const directory = resolve(ROOT, args.dir);
  if (!existsSync(directory)) {
    console.error(`no such directory: ${directory}`);
    process.exit(1);
  }
  const tarballs = readdirSync(directory)
    .filter((name) => /^countersign-hub-.*\.tgz$/.test(name))
    .sort()
    .map((name) => join(directory, name));
  if (tarballs.length === 0) {
    console.error(`no countersign-hub-*.tgz in ${directory}`);
    process.exit(1);
  }

  for (const tarball of tarballs) smokeTarball(tarball);
  if (failed) process.exit(1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}
