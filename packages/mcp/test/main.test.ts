import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { main, resolveAccount } from "../src/index.ts";

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

describe("resolveAccount", () => {
  test("uses a loader's account", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    expect(await resolveAccount({ loadAccount: async () => account }, {})).toEqual({ account });
  });

  test("a loader returning undefined leaves no account and no problem", async () => {
    expect(await resolveAccount({ loadAccount: async () => undefined }, {})).toEqual({});
  });

  test("a loader that throws becomes a one-line problem", async () => {
    const resolved = await resolveAccount(
      {
        loadAccount: async () => {
          throw new Error("session file is corrupt\nsecond line");
        },
      },
      {},
    );
    expect(resolved.account).toBeUndefined();
    expect(resolved.problem).toBe("Could not load the countersign session: session file is corrupt");
  });

  test("without a loader, CS_BUYER_KEY signs in", async () => {
    const key = generatePrivateKey();
    const resolved = await resolveAccount({}, { CS_BUYER_KEY: key });
    expect(resolved.problem).toBeUndefined();
    expect(resolved.account?.address).toBe(privateKeyToAccount(key).address);
  });

  test("a malformed CS_BUYER_KEY is a problem and does not exit", async () => {
    const resolved = await resolveAccount({}, { CS_BUYER_KEY: "nonsense" });
    expect(resolved.account).toBeUndefined();
    expect(resolved.problem).toBe("CS_BUYER_KEY is not a valid key.");
  });
});
