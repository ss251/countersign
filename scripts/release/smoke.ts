import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseSmokeArgs } from "./args.ts";
import { floorMajor } from "./engines.ts";
import { isRecord } from "./json.ts";
import { PUBLISH_SCOPE, publishedName } from "./published.ts";

const ROOT = resolve(import.meta.dir, "..", "..");

type Run = {
  code: number;
  stdout: string;
  stderr: string;
};

type Runtime = {
  version: string;
  command: string[];
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

function parseVersion(text: string): string | null {
  const match = /\bv(\d+\.\d+\.\d+)\b/.exec(text);
  return match?.[1] === undefined ? null : `v${match[1]}`;
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

function installedNodeVersion(): string | null {
  const result = run(["node", "--version"], ROOT);
  const text = output(result);
  console.log(`node --version: ${text}`);
  return parseVersion(text);
}

function floorRuntime(major: number, cwd: string): Runtime {
  const result = run(["npx", "-y", `node@${major}`, "--version"], cwd);
  const fetched = parseVersion(output(result));
  if (result.code !== 0 || fetched === null || !fetched.startsWith(`v${major}.`)) {
    check(`node ${major}`, false, `could not obtain node@${major}`);
    process.exit(1);
  }
  console.log(`node ${major} --version: ${fetched}`);
  return { version: fetched, command: ["npx", "-y", `node@${major}`] };
}

function smokeTarball(tarball: string, current: string, useFloor: boolean): void {
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

    const engines = installed.manifest.engines;
    const engineNode = isRecord(engines) ? engines.node : undefined;
    const floor = floorMajor(engineNode) ?? 20;
    const runtimes: Runtime[] = [{ version: current, command: ["node"] }];
    if (useFloor) runtimes.push(floorRuntime(floor, work));
    else console.log(`SKIP node ${floor} (--no-node20)`);

    const packageDir = join(work, "node_modules", ...installed.name.split("/"));
    for (const [name, relativeBin] of binEntries(installed.name, installed.manifest.bin)) {
      const binFile = join(packageDir, relativeBin.replace(/^\.\//, ""));
      for (const runtime of runtimes) {
        const result = run([...runtime.command, binFile, "--help"], work);
        check(
          `${short} bin ${name} --help [node ${runtime.version}]`,
          result.code === 0 && output(result).length > 0,
          output(result),
        );
      }
    }

    if (short === "cli") {
      const childEntry = join(packageDir, "dist", "child-entry.js");
      for (const runtime of runtimes) {
        const result = run(
          [
            ...runtime.command,
            "--input-type=module",
            "-e",
            `import { existsSync } from "node:fs"; process.exit(existsSync(${JSON.stringify(childEntry)}) ? 0 : 1);`,
          ],
          work,
        );
        check(
          `${short} child entry dist/child-entry.js [node ${runtime.version}]`,
          result.code === 0,
          output(result),
        );
      }
    }

    for (const subpath of exportSubpaths(installed.manifest.exports)) {
      const spec = specifier(installed.name, subpath);
      if (spec.includes("*")) {
        check(`${short} export ${spec}`, false, "wildcard export needs a concrete subpath");
        continue;
      }
      for (const runtime of runtimes) {
        const result = run(
          [...runtime.command, "--input-type=module", "-e", `await import(${JSON.stringify(spec)});`],
          work,
        );
        check(
          `${short} export ${spec} [node ${runtime.version}]`,
          result.code === 0,
          output(result),
        );
      }
    }

    if (short === "relay") {
      for (const runtime of runtimes) {
        const result = run(
          [
            ...runtime.command,
            "--input-type=module",
            "-e",
            `await import(${JSON.stringify(installed.name)});`,
          ],
          work,
        );
        const detail = output(result);
        check(
          `${short} root is not resolvable [node ${runtime.version}]`,
          result.code !== 0 && detail.includes("ERR_PACKAGE_PATH_NOT_EXPORTED"),
          detail,
        );
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const current = installedNodeVersion();
  const major = current === null ? null : Number(current.slice(1).split(".")[0]);
  if (current === null || major === null || major < 20) {
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

  for (const tarball of tarballs) smokeTarball(tarball, current, args.node20 !== false);
  if (failed) process.exit(1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}
