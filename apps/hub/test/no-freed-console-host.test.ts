import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const hubRoot = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("the hub never names the freed console host", () => {
  test("no TypeScript file under apps/hub/src contains web-production-a58de", () => {
    const hits = sources(join(hubRoot, "src"))
      .filter((file) => readFileSync(file, "utf8").includes("web-production-a58de"))
      .map((file) => file.slice(hubRoot.length + 1));
    expect(hits).toEqual([]);
  });
});
