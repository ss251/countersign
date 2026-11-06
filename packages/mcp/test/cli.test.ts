import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const cwd = join(import.meta.dir, "..");

async function run(args: string[], env: Record<string, string>) {
  const child = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("the stdio CLI", () => {
  test("refuses CS_NETWORK=mainnet before serving anything", async () => {
    const { code, stdout, stderr } = await run([], { PATH: process.env.PATH ?? "", CS_NETWORK: "mainnet" });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("countersign-mcp is testnet only: CS_NETWORK must be unset or testnet.");
  });

  test("--help prints usage to stdout and exits 0", async () => {
    const { code, stdout, stderr } = await run(["--help"], { PATH: process.env.PATH ?? "" });
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: countersign mcp");
    expect(stdout).toContain("--hub <url>");
    expect(stdout).toContain("Sign in once: npx -y @countersign-hub/cli login.");
    expect(stdout).toContain("CS_NETWORK must be unset or testnet.");
    expect(stdout).toContain("never npx or npm install them");
    expect(stdout).not.toContain("CS_BUYER_KEY");
    expect(stdout).not.toContain("CS_SELLER_KEY");
    expect(stdout).not.toContain("private key");
    expect(stderr).toBe("");
  });
});
