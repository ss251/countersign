import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  buildEnvironment,
  checkFiles,
  findLeaks,
  formatLeaks,
  readTarball,
  type LeakEnvironment,
} from "../leaks.ts";

const temporary: string[] = [];

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "countersign-leaks-test-"));
  temporary.push(root);
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, "package", ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const tarball = join(root, "fixture.tgz");
  const result = spawnSync("tar", ["-czf", tarball, "-C", root, "package"], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`fixture tar failed: ${result.stderr}`);
  return tarball;
}

function environment(overrides: Partial<LeakEnvironment> = {}): LeakEnvironment {
  return {
    homeDir: "/fixture/home",
    userName: "fixture-user",
    hostName: "fixture-host",
    repoRoot: "/fixture/repo",
    tempPrefix: "/fixture/tmp/",
    ...overrides,
  };
}

function message(tarball: string, env: LeakEnvironment): string {
  return formatLeaks(tarball, findLeaks(readTarball(tarball), env));
}

describe("the release leak check", () => {
  test("a clean tarball passes", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture","version":"1.0.0"}\n',
      "README.md": "# fixture\n",
      "LICENSE": "MIT\n",
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.mjs": "export const answer = 42;\n",
      "dist/index.cjs": "module.exports = { answer: 42 };\n",
      "dist/types.d.ts": "export declare const answer: number;\n",
      "dist/data.json": '{"ok":true}\n',
      "dist/nested/deep.js": "export const deep = true;\n",
    });
    const files = readTarball(tarball);
    expect(findLeaks(files, environment())).toEqual([]);
    expect(checkFiles(tarball, files, environment())).toBe(9);
  });

  test("a source map file fails and is named", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.js.map": '{"version":3,"sources":["../src/index.ts"]}\n',
    });
    const leaks = findLeaks(readTarball(tarball), environment());
    expect(leaks).toEqual([{ file: "dist/index.js.map", line: 1, kind: "source map" }]);
    const text = message(tarball, environment());
    expect(text).toContain(basename(tarball));
    expect(text).toContain("dist/index.js.map");
    expect(text).toContain("source map");
  });

  test("a sourceMappingURL comment fails on its line", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": "export const answer = 42;\n//# sourceMappingURL=index.js.map\n",
    });
    const leaks = findLeaks(readTarball(tarball), environment());
    expect(leaks).toContainEqual({
      file: "dist/index.js",
      line: 2,
      kind: "sourceMappingURL",
    });
  });

  test("the home directory fails with the kind and not the path", () => {
    const home = homedir();
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": `export const here = ${JSON.stringify(`${home}/project`)};\n`,
    });
    const text = message(tarball, buildEnvironment());
    expect(text).toContain("home directory");
    expect(text).not.toContain(home);
  });

  test("/Users/ fails with its kind", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": 'export const here = "/Users/example/project";\n',
    });
    const text = message(tarball, environment());
    expect(text).toContain("/Users/");
    expect(text).toContain("dist/index.js:1");
  });

  test("the host name fails case-insensitively", () => {
    const host = hostname();
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": `export const host = ${JSON.stringify(host.toUpperCase())};\n`,
    });
    const leaks = findLeaks(readTarball(tarball), buildEnvironment());
    expect(leaks.map((leak) => leak.kind)).toContain("host name");
  });

  test("an extra notes.txt fails as not allowed", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": "export {};\n",
      "notes.txt": "local notes\n",
    });
    const leaks = findLeaks(readTarball(tarball), environment());
    expect(leaks).toContainEqual({ file: "notes.txt", line: 1, kind: "not an allowed file" });
    expect(message(tarball, environment())).toContain("notes.txt");
  });

  test("an extra .env fails as not allowed", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": "export {};\n",
      ".env": "SECRET=local\n",
    });
    const leaks = findLeaks(readTarball(tarball), environment());
    expect(leaks).toContainEqual({ file: ".env", line: 1, kind: "not an allowed file" });
  });

  test("an empty or one-character user name does not match everything", () => {
    const tarball = fixture({
      "package.json": '{"name":"fixture"}\n',
      "dist/index.js": "export const noise = \"aaaaaaaaaaaa\";\n",
    });
    expect(findLeaks(readTarball(tarball), environment({ userName: "" }))).toEqual([]);
    expect(findLeaks(readTarball(tarball), environment({ userName: "a" }))).toEqual([]);
  });
});
