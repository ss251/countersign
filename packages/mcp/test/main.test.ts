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

  test("a loader is given and CS_SESSION still does not linger in the env", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const env: Record<string, string | undefined> = {
      CS_SESSION: "token",
      CS_HUB: "https://hub.invalid",
    };
    expect(await resolveAccount({ loadAccount: async () => account }, env)).toEqual({ account });
    expect(env.CS_SESSION).toBeUndefined();
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
    expect(resolved.problem).toBe("The configured signer is not valid.");
  });

  test("with CS_SESSION it uses the hub's session", async () => {
    const address = privateKeyToAccount(generatePrivateKey()).address;
    const env: Record<string, string | undefined> = { CS_SESSION: "token", CS_HUB: "https://hub.invalid" };
    const original = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => Response.json({ address, expiresAt: 1_762_400_600 }),
      { preconnect: () => undefined },
    );
    try {
      const resolved = await resolveAccount({}, env);
      expect(resolved.problem).toBeUndefined();
      expect(resolved.account?.address).toBe(address);
      expect(env.CS_SESSION).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a failing session read becomes a one-line problem", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => Response.json({ message: "Boom." }, { status: 500 }), {
      preconnect: () => undefined,
    });
    try {
      const resolved = await resolveAccount(
        {},
        { CS_SESSION: "token", CS_HUB: "https://hub.invalid" },
      );
      expect(resolved.account).toBeUndefined();
      expect(resolved.problem).toBe("Could not load the countersign session: Could not read the countersign session (500).");
    } finally {
      globalThis.fetch = original;
    }
  });
});
