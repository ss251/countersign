import { describe, expect, test } from "bun:test";

// cs-e2e, run 20261106-181838-9add: the embedded wallet's eth_signTypedData_v4 threw "Buffer is not defined".
describe("the console's Buffer polyfill", () => {
  test("installs a working Buffer where the browser has none", async () => {
    const scope = globalThis as { Buffer?: unknown };
    const native = scope.Buffer;
    delete scope.Buffer;
    try {
      await import("../src/polyfills.ts");
      const B = scope.Buffer as { from(s: string, enc: string): { toString(enc: string): string } } | undefined;
      expect(B).toBeDefined();
      expect(B!.from("deadbeef", "hex").toString("base64")).toBe("3q2+7w==");
    } finally {
      scope.Buffer = native;
    }
  });

  test("main.tsx imports it before anything else", async () => {
    const main = await Bun.file(new URL("../src/main.tsx", import.meta.url)).text();
    const firstImport = main.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./polyfills.ts";');
  });

  test("the console declares buffer itself, so an isolated install resolves it", async () => {
    const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.buffer).toBe("6.0.3");
  });
});
