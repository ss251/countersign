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
  bundleEntries,
  dependencyUnion,
  entrySources,
  extraDependencyRanges,
  sourceTargetMap,
  stagedManifest,
  type BundleEntry,
  type ManifestSource,
  type PackageManifest,
} from "./manifest.ts";
import { tarballPrefix } from "./published.ts";
import { withNodeShebang } from "./shebang.ts";
import {
  extraDependenciesFor,
  omittedExportLines,
  PUBLISH_SURFACE,
} from "./surface.ts";

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
  rootDir: string;
  bundleDir: string;
  stageDir: string;
  entries: readonly BundleEntry[];
}): EmittedFile[] {
  const outputs = new Map<string, string>();
  for (const output of listBundleOutputs(input.bundleDir)) {
    outputs.set(relativePath(input.bundleDir, output), output);
  }

  const emitted: EmittedFile[] = [];
  const consumed = new Set<string>();
  for (const entry of input.entries) {
    const absolute = resolve(input.rootDir, entry.source);
    const sourceRelative = relativePath(input.rootDir, absolute);
    const outputRelative = sourceRelative.replace(SOURCE_EXTENSION, ".js");
    const output = outputs.get(outputRelative);
    if (output === undefined) {
      throw new Error(
        `Bun.build emitted no ${outputRelative} for ${input.short} entry ${entry.source}`,
      );
    }
    const destination = resolve(input.stageDir, entry.target.replace(/^\.\//, ""));
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

function guardPackage(short: string, emitted: readonly EmittedFile[]): void {
  const problems: string[] = [];
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
  const extra = extraDependencyRanges(short, extraDependenciesFor(short), (workspace) => {
    const file = join(ROOT, "packages", workspace, "package.json");
    return existsSync(file) ? readPackageManifest(workspace) : null;
  });
  for (const line of extra.skipped) console.log(line);
  const declared = { ...dependencies, ...extra.dependencies };

  const entries = entrySources(manifest, { short, surface: PUBLISH_SURFACE });
  if (entries.length === 0) {
    throw new Error(`packages/${short}/package.json has no bin or exports source entries`);
  }
  const targets = sourceTargetMap(entries);
  const bundle = bundleEntries(short, manifest, { short, surface: PUBLISH_SURFACE });

  const stageDir = join(outRoot, "stage", short);
  const bundleDir = join(stageDir, ".bundle");
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: bundle.map((entry) => resolve(ROOT, entry.source)),
    target: "node",
    format: "esm",
    outdir: bundleDir,
    root: ROOT,
    external: externalPatterns(Object.keys(declared)),
    sourcemap: "external",
    splitting: false,
  });
  if (!result.success) {
    const logs = result.logs.map((log) => String(log)).join("\n");
    throw new Error(`Bun.build failed for ${short}${logs.length > 0 ? `:\n${logs}` : ""}`);
  }

  const emitted = moveOutputs({
    short,
    rootDir: ROOT,
    bundleDir,
    stageDir,
    entries: bundle,
  });

  const imported: ImportedPackage[] = [];
  for (const file of emitted) {
    for (const name of scanImportPackages(readFileSync(file.path, "utf8"))) {
      imported.push({ package: name, file: file.file });
    }
  }
  const selection = selectDependencies(imported, declared);
  console.log(
    `${short}: dependencies ${selection.imported.length} of ${Object.keys(declared).length} ` +
      `declared: ${selection.imported.join(", ")}`,
  );
  const stagedDependencies = { ...selection.dependencies, ...extra.dependencies };

  const staged = stagedManifest({
    short,
    manifest,
    dependencies: stagedDependencies,
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
