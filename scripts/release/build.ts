import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBuildArgs, planBuild } from "./args.ts";
import { externalPatterns } from "./external.ts";
import { findNodeGuardViolations, findSourceWithText } from "./guard.ts";
import {
  scanImportPackages,
  selectDependencies,
  type ImportedPackage,
} from "./imports.ts";
import { isRecord, type JsonObject } from "./json.ts";
import { buildEnvironment, checkFiles, readDist, readTarball } from "./leaks.ts";
import {
  dependencyUnion,
  entrySources,
  sourceTargetMap,
  stagedManifest,
  type ManifestSource,
  type PackageManifest,
} from "./manifest.ts";
import { tarballPrefix } from "./published.ts";
import { withNodeShebang } from "./shebang.ts";
import { omittedExportLines, PUBLISH_SURFACE } from "./surface.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const LEAK_ENVIRONMENT = buildEnvironment();

type EmittedFile = {
  file: string;
  path: string;
  mapPath: string | undefined;
  mapBase: string;
};

type Packed = {
  tarball: string;
  size: number;
  files: string[];
};

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

function readPackageManifest(short: string): ManifestSource {
  const label = `packages/${short}/package.json`;
  const file = join(ROOT, "packages", short, "package.json");
  if (!existsSync(file)) throw new Error(`${label} does not exist`);
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${label} is not an object`);
  return { label, manifest: parsed as PackageManifest };
}

function relativePath(base: string, file: string): string {
  return relative(base, file).split(sep).join("/");
}

function displayPath(file: string): string {
  const rel = relative(ROOT, file);
  return rel.startsWith("..") ? file : rel.split(sep).join("/");
}

function resolveMapSource(mapBase: string, source: string): string {
  if (source.startsWith("file://")) {
    try {
      return fileURLToPath(source);
    } catch {
      return source;
    }
  }
  // Bun writes source-map paths relative to the bundle output directory, not
  // to the .map file itself.
  return resolve(mapBase, source);
}

function moveOutputs(input: {
  short: string;
  packageDir: string;
  bundleDir: string;
  stageDir: string;
  entries: readonly string[];
  targets: Record<string, string>;
}): EmittedFile[] {
  const result = input.entries.map((entry) =>
    resolve(input.packageDir, entry),
  );
  const outputs = new Map<string, string>();
  for (const output of listBundleOutputs(input.bundleDir)) {
    outputs.set(relativePath(input.bundleDir, output), output);
  }

  const emitted: EmittedFile[] = [];
  const consumed = new Set<string>();
  for (let i = 0; i < input.entries.length; i++) {
    const entry = input.entries[i];
    const absolute = result[i];
    if (entry === undefined || absolute === undefined) continue;
    const sourceRelative = relativePath(input.packageDir, absolute);
    const outputRelative = sourceRelative.replace(SOURCE_EXTENSION, ".js");
    const output = outputs.get(outputRelative);
    if (output === undefined) {
      throw new Error(`Bun.build emitted no ${outputRelative} for ${input.short} entry ${entry}`);
    }
    const target = input.targets[entry];
    if (target === undefined) throw new Error(`no staged target for ${input.short} entry ${entry}`);
    const destination = resolve(input.stageDir, target.replace(/^\.\//, ""));
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(output, destination);
    consumed.add(output);
    const mapPath = `${output}.map`;
    emitted.push({
      file: displayPath(destination),
      path: destination,
      mapPath: existsSync(mapPath) ? mapPath : undefined,
      mapBase: input.bundleDir,
    });
  }

  for (const output of outputs.values()) {
    if (!consumed.has(output)) {
      throw new Error(
        `Bun.build produced an unexpected output for ${input.short}: ${relativePath(input.bundleDir, output)}`,
      );
    }
  }
  return emitted;
}

function listBundleOutputs(bundleDir: string): string[] {
  const outputs: string[] = [];
  for (const file of new Bun.Glob("**/*.js").scanSync({ cwd: bundleDir })) {
    outputs.push(resolve(bundleDir, file));
  }
  return outputs.sort();
}

function binPaths(staged: JsonObject): string[] {
  const bin = staged.bin;
  if (bin === undefined) return [];
  if (typeof bin === "string") return [bin];
  if (!isRecord(bin)) throw new Error("staged bin is not a string or object");
  return Object.values(bin).map((value) => {
    if (typeof value !== "string") throw new Error("staged bin contains a non-string path");
    return value;
  });
}

function rewriteBins(stageDir: string, staged: JsonObject): void {
  for (const relativeBin of binPaths(staged)) {
    const file = resolve(stageDir, relativeBin.replace(/^\.\//, ""));
    if (!existsSync(file)) throw new Error(`staged bin file is missing: ${relativeBin}`);
    writeFileSync(file, withNodeShebang(readFileSync(file, "utf8")));
    chmodSync(file, 0o755);
  }
}

function sourceFiles(mapPath: string, mapBase: string): { file: string; code: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const sources = parsed.sources;
  const contents = parsed.sourcesContent;
  if (!Array.isArray(sources) || !Array.isArray(contents)) return [];
  const files: { file: string; code: string }[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const code = contents[i];
    if (typeof source !== "string" || typeof code !== "string") continue;
    files.push({ file: displayPath(resolveMapSource(mapBase, source)), code });
  }
  return files;
}

function guardPackage(short: string, emitted: readonly EmittedFile[]): void {
  const problems: string[] = [];
  const reported = new Set<string>();
  const maps = new Map<string, string>();

  for (const file of emitted) {
    const code = readFileSync(file.path, "utf8");
    const violations = findNodeGuardViolations(code);
    const seen = new Set<string>();
    for (const violation of violations) {
      if (seen.has(violation.pattern)) continue;
      seen.add(violation.pattern);

      let origin: string | null = null;
      if (file.mapPath !== undefined) {
        let mapJson = maps.get(file.mapPath);
        if (mapJson === undefined) {
          mapJson = readFileSync(file.mapPath, "utf8");
          maps.set(file.mapPath, mapJson);
        }
        const source = findSourceWithText(mapJson, violation.text, violation.pattern);
        if (source !== null) origin = displayPath(resolveMapSource(file.mapBase, source));
      }
      const suffix = origin === null ? "" : ` (source ${origin})`;
      problems.push(`${file.file}:${violation.line}:${violation.column} "${violation.text}"${suffix}`);
      if (origin !== null) reported.add(`${origin}:${violation.pattern}`);
    }
  }

  const scanned = new Set<string>();
  for (const file of emitted) {
    if (file.mapPath === undefined || scanned.has(file.mapPath)) continue;
    scanned.add(file.mapPath);
    for (const source of sourceFiles(file.mapPath, file.mapBase)) {
      const seen = new Set<string>();
      for (const violation of findNodeGuardViolations(source.code)) {
        if (seen.has(violation.pattern)) continue;
        seen.add(violation.pattern);
        const key = `${source.file}:${violation.pattern}`;
        if (reported.has(key)) continue;
        reported.add(key);
        problems.push(
          `${source.file}:${violation.line}:${violation.column} "${violation.text}"`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Node guard failed for ${short}:\n${problems.map((problem) => `  ${problem}`).join("\n")}\n` +
        "Bun-only APIs in package sources are not rewritten by this build.",
    );
  }
}

function packedFiles(record: JsonObject, tarball: string): string[] {
  const files = record.files;
  const paths: string[] = [];
  if (Array.isArray(files)) {
    for (const file of files) {
      if (isRecord(file) && typeof file.path === "string") paths.push(file.path);
    }
  }
  if (paths.length > 0) return paths.sort();

  return spawnOrFail(["tar", "-tzf", tarball], ROOT)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/"))
    .map((line) => (line.startsWith("package/") ? line.slice("package/".length) : line))
    .sort();
}

function pack(input: {
  short: string;
  version: string;
  stageDir: string;
  outRoot: string;
}): Packed {
  const stdout = spawnOrFail(
    ["npm", "pack", "--json", "--pack-destination", input.outRoot],
    input.stageDir,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack did not produce JSON for ${input.short}:\n${stdout.trim()}`);
  }
  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!isRecord(record) || typeof record.filename !== "string") {
    throw new Error(`npm pack produced no filename for ${input.short}`);
  }

  const tarball = resolve(input.outRoot, record.filename);
  const name = basename(tarball);
  const expected = `${tarballPrefix(input.short)}-${input.version}.tgz`;
  if (!/^countersign-hub-.*\.tgz$/.test(name)) {
    throw new Error(`npm pack produced an unexpected tarball name: ${name}`);
  }
  if (name !== expected) {
    throw new Error(`npm pack produced ${name}, expected ${expected}`);
  }

  return {
    tarball,
    size: statSync(tarball).size,
    files: packedFiles(record, tarball),
  };
}

async function buildPackage(short: string, outRoot: string): Promise<Packed> {
  const packageDir = join(ROOT, "packages", short);
  const source = readPackageManifest(short);
  const manifest = source.manifest;
  for (const line of omittedExportLines(short, source.label, manifest.exports)) {
    console.log(line);
  }
  const dependencies = dependencyUnion(short, readPackageManifest);
  const entries = entrySources(manifest, { short, surface: PUBLISH_SURFACE });
  if (entries.length === 0) {
    throw new Error(`packages/${short}/package.json has no bin or exports source entries`);
  }
  const targets = sourceTargetMap(entries);

  const stageDir = join(outRoot, "stage", short);
  const bundleDir = join(stageDir, ".bundle");
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: entries.map((entry) => resolve(packageDir, entry)),
    target: "node",
    format: "esm",
    outdir: bundleDir,
    root: packageDir,
    external: externalPatterns(Object.keys(dependencies)),
    sourcemap: "external",
    splitting: false,
  });
  if (!result.success) {
    const logs = result.logs.map((log) => String(log)).join("\n");
    throw new Error(`Bun.build failed for ${short}${logs.length > 0 ? `:\n${logs}` : ""}`);
  }

  const emitted = moveOutputs({
    short,
    packageDir,
    bundleDir,
    stageDir,
    entries,
    targets,
  });

  const imported: ImportedPackage[] = [];
  for (const file of emitted) {
    for (const name of scanImportPackages(readFileSync(file.path, "utf8"))) {
      imported.push({ package: name, file: file.file });
    }
  }
  const selection = selectDependencies(imported, dependencies);
  console.log(
    `${short}: dependencies ${selection.imported.length} of ${Object.keys(dependencies).length} ` +
      `declared: ${selection.imported.join(", ")}`,
  );

  const staged = stagedManifest({
    short,
    manifest,
    dependencies: selection.dependencies,
    targets,
    surface: PUBLISH_SURFACE,
  });
  if (typeof staged.version !== "string") throw new Error(`staged ${short} manifest has no version`);
  writeFileSync(join(stageDir, "package.json"), `${JSON.stringify(staged, null, 2)}\n`);
  rewriteBins(stageDir, staged);
  guardPackage(short, emitted);
  checkFiles(displayPath(stageDir), readDist(stageDir), LEAK_ENVIRONMENT);

  rmSync(bundleDir, { recursive: true, force: true });
  const packed = pack({ short, version: staged.version, stageDir, outRoot });
  const clean = checkFiles(packed.tarball, readTarball(packed.tarball), LEAK_ENVIRONMENT);
  console.log(`${short}: packed files clean (${clean} files)`);
  return packed;
}

async function main(): Promise<void> {
  const args = parseBuildArgs(process.argv.slice(2));
  const outRoot = resolve(ROOT, args.out);
  const plan = planBuild({
    only: args.only,
    require: args.require,
    exists: (short) => existsSync(join(ROOT, "packages", short, "package.json")),
  });

  for (const short of plan.skipped) {
    console.log(`skip ${short}: packages/${short} does not exist`);
  }
  if (plan.build.length === 0) {
    console.log("nothing to build");
    return;
  }

  mkdirSync(outRoot, { recursive: true });
  for (const short of plan.build) {
    const packed = await buildPackage(short, outRoot);
    console.log(`${short}: ${packed.tarball}`);
    console.log(`  size: ${packed.size} bytes`);
    console.log("  files:");
    for (const file of packed.files) console.log(`    ${file}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
});
