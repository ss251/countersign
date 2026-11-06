import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { walletAccount } from "../src/refund-client.ts";

const here = import.meta.dir;

describe("the browser entry", () => {
  test("builds for the browser and reaches no node, bun or hono module", async () => {
    const entry = join(here, "../src/browser.ts");
    const built = await Bun.build({ entrypoints: [entry], target: "browser" });
    expect(built.success).toBe(true);
    expect(built.outputs.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/gm,
      )) {
        const specifier = match[2]!;
        expect(specifier.startsWith("node:")).toBe(false);
        expect(specifier.startsWith("bun:")).toBe(false);
        expect(specifier === "hono" || specifier.startsWith("hono/")).toBe(false);
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          if (target.endsWith(".ts")) queue.push(target);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe("walletAccount", () => {
  test("signs typed data through the given function", async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const calls: unknown[] = [];
    const account = walletAccount(key.address, async (typedData) => {
      calls.push(typedData);
      return "0x1234" as Hex;
    });

    const signature = await account.signTypedData({
      domain: { name: "Test", version: "1", chainId: 1874 },
      types: { Thing: [{ name: "value", type: "uint256" }] },
      primaryType: "Thing",
      message: { value: 1n },
    });

    expect(signature).toBe("0x1234");
    expect(calls).toHaveLength(1);
  });

  test("refuses to sign a message or a transaction", async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const account = walletAccount(key.address, async () => "0x1234" as Hex);
    await expect(account.signMessage({ message: "hello" })).rejects.toThrow(
      "only typed-data signatures are supported",
    );
    await expect(
      (account.signTransaction as (transaction: unknown) => Promise<Hex>)({}),
    ).rejects.toThrow("only typed-data signatures are supported");
  });
});
