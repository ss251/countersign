import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, relative, resolve, sep } from "node:path";

export type ArchiveFile = {
  path: string;
  text: string;
};

export type LeakEnvironment = {
  homeDir: string;
  userName: string;
  hostName: string;
  repoRoot: string;
  tempPrefix: string;
};

export type Leak = {
  file: string;
  line: number;
  kind: string;
};

/**
 * Literal fragments that name a build machine regardless of the current user.
 * These are never shortened by the three-character rule because they are all
 * longer than it already.
 */
const ENVIRONMENT_PATTERNS: readonly string[] = [
  "/Users/",
  "/home/",
  "/private/var",
  "/Volumes/",
  "C:\\Users",
];

const ALLOWED_ROOT_FILES: readonly RegExp[] = [/^package\.json$/, /^README.*$/, /^LICENSE.*$/];
const ALLOWED_DIST_FILE = /^dist\/.+\.(?:js|mjs|cjs|d\.ts|json)$/;

export function isAllowedFile(path: string): boolean {
  const normalized = path.replace(/^\.\//, "");
  if (ALLOWED_ROOT_FILES.some((expression) => expression.test(normalized))) return true;
  return ALLOWED_DIST_FILE.test(normalized);
}

function sensitiveStrings(environment: LeakEnvironment): {
  kind: string;
  value: string;
  ignoreCase: boolean;
}[] {
  const named = [
    { kind: "home directory", value: environment.homeDir, ignoreCase: false },
    { kind: "user name", value: environment.userName, ignoreCase: false },
    { kind: "host name", value: environment.hostName, ignoreCase: true },
    { kind: "repository root", value: environment.repoRoot, ignoreCase: false },
    { kind: "temporary directory", value: environment.tempPrefix, ignoreCase: false },
  ];
  const patterns = ENVIRONMENT_PATTERNS.map((value) => ({
    kind: value,
    value,
    ignoreCase: false,
  }));
  // A short user name would otherwise match ordinary prose.
  return [...named, ...patterns].filter((entry) => entry.value.length >= 3);
}

function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Pure scan over extracted files. Paths are relative to the package root and
 * text is the file body. The returned leaks never carry the matched text, so
 * a failing log cannot echo the path it found.
 */
export function findLeaks(
  files: readonly ArchiveFile[],
  environment: LeakEnvironment,
): Leak[] {
  const sensitive = sensitiveStrings(environment);
  const leaks: Leak[] = [];

  for (const entry of files) {
    const file = entry.path.split(sep).join("/");
    if (file.endsWith(".map")) {
      leaks.push({ file, line: 1, kind: "source map" });
      continue;
    }
    if (!isAllowedFile(file)) {
      leaks.push({ file, line: 1, kind: "not an allowed file" });
    }

    const mapUrl = entry.text.indexOf("sourceMappingURL");
    if (mapUrl >= 0) {
      leaks.push({ file, line: lineNumber(entry.text, mapUrl), kind: "sourceMappingURL" });
    }

    for (const source of sensitive) {
      const haystack = source.ignoreCase ? entry.text.toLowerCase() : entry.text;
      const needle = source.ignoreCase ? source.value.toLowerCase() : source.value;
      const index = haystack.indexOf(needle);
      if (index >= 0) {
        leaks.push({ file, line: lineNumber(entry.text, index), kind: source.kind });
      }
    }
  }

  return leaks;
}

export function formatLeaks(artifact: string, leaks: readonly Leak[]): string {
  const lines = leaks.map((leak) => `  ${leak.file}:${leak.line}: ${leak.kind}`);
  return `release leak check failed for ${artifact}:\n${lines.join("\n")}`;
}

/**
 * The one check both the staged `dist/` and the packed tarball run.
 * Returns the number of files inspected so the caller can report the count.
 */
export function checkFiles(
  artifact: string,
  files: readonly ArchiveFile[],
  environment: LeakEnvironment,
): number {
  const leaks = findLeaks(files, environment);
  if (leaks.length > 0) throw new Error(formatLeaks(artifact, leaks));
  return files.length;
}

function spawnTar(args: readonly string[], cwd: string): void {
  const result = spawnSync("tar", [...args], {
    cwd,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(stderr.length > 0 ? stderr : `tar exited ${result.status}`);
  }
}

/** Reads every regular file under `root`, with `/`-separated relative paths. */
export function readTree(root: string): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      files.push({
        path: relative(root, full).split(sep).join("/"),
        text: entry.isFile() ? readFileSync(full, "utf8") : "",
      });
    }
  };
  walk(root);
  return files;
}

/** Reads the staged package's `dist/` with paths relative to the package root. */
export function readDist(stageDir: string): ArchiveFile[] {
  return readTree(join(stageDir, "dist")).map((file) => ({
    path: `dist/${file.path}`,
    text: file.text,
  }));
}

/** Extracts a tarball under os.tmpdir() and reads every packed file. */
export function readTarball(tarball: string): ArchiveFile[] {
  const root = mkdtempSync(join(tmpdir(), "countersign-leaks-"));
  try {
    spawnTar(["-xzf", resolve(tarball), "-C", root], resolve("."));
    const packageDir = join(root, "package");
    return readTree(existsSync(packageDir) ? packageDir : root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function buildEnvironment(overrides: Partial<LeakEnvironment> = {}): LeakEnvironment {
  return {
    homeDir: homedir(),
    userName: userInfo().username,
    hostName: hostname(),
    repoRoot: resolve(import.meta.dir, "..", ".."),
    tempPrefix: tmpdir(),
    ...overrides,
  };
}
