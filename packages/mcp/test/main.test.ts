import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { main } from "../src/index.ts";

const indexPath = join(import.meta.dir, "..", "src", "index.ts");

async function runImport(): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  const child = Bun.spawn(["bun", "-e", `await import(${JSON.stringify(indexPath)}); console.log("imported")`], {
    env: { PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 5000);
  const code = await child.exited;
  clearTimeout(timer);
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr, timedOut };
}

describe("the package entry point", () => {
  test("exports main as a function", () => {
    expect(typeof main).toBe("function");
  });

  test("importing it does not start a server", async () => {
    const { code, stdout, stderr, timedOut } = await runImport();
    expect(timedOut).toBe(false);
    expect(code).toBe(0);
    expect(stdout).toBe("imported\n");
    expect(stderr).toBe("");
  });
});
