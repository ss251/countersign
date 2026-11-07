import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CLI_DEFAULT_HUB, buyCommand } from "../src/routes/offer/index.tsx";

/**
 * Firstmate 02:06:42Z (the captain found it): the offer page's Copy gave the raw-key dev tool,
 * "bun packages/buyer/src/cli.ts buy ... --hub ...", and said the key comes from CS_BUYER_KEY. The product signs
 * through a Privy server wallet, so the command is the published CLI and nobody handles a key.
 */
const HASH = `0x${"ab".repeat(32)}`;
const SCHEMA = { type: "object", properties: { question: { type: "string" } }, required: ["question"] } as never;
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe("the offer page's buy command (firstmate 02:06:42Z)", () => {
  test("it is the published CLI, with no --hub on the CLI's own default hub", () => {
    for (const hub of [CLI_DEFAULT_HUB, `${CLI_DEFAULT_HUB}/`]) {
      const cmd = buyCommand(HASH, SCHEMA, hub);
      expect(cmd.startsWith(`npx -y @countersign-hub/cli buy ${HASH} --input '`)).toBe(true);
      expect(cmd).not.toContain("--hub");
      expect(cmd).not.toContain("packages/buyer/src/cli.ts");
    }
  });

  test("on any other hub it names that hub", () => {
    expect(buyCommand(HASH, SCHEMA, "http://localhost:8787").endsWith("' --hub http://localhost:8787")).toBe(true);
    expect(buyCommand(HASH, SCHEMA, "https://counter-sign.up.railway.app/hub")).toContain("--hub https://counter-sign.up.railway.app/hub");
  });

  test("the console's default is the CLI's own default hub", () => {
    expect(src("../../../packages/cli/src/cli.ts")).toContain(`export const DEFAULT_HUB = "${CLI_DEFAULT_HUB}";`);
  });

  test("the note says sign in with Privy and no key is on your machine", () => {
    expect(src("../src/routes/offer/index.tsx")).toContain(
      "Sign in once with npx -y @countersign-hub/cli login. The agent’s wallet is a Privy server wallet our app controls, so no key is on your machine.",
    );
  });

  test("nothing the bundle is built from names CS_BUYER_KEY or the clone's buy command", () => {
    const sources = [
      ...filesUnder(new URL("../src", import.meta.url).pathname),
      new URL("../../../docs/onboarding.md", import.meta.url).pathname,
    ];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect({ file, hits: text.includes("CS_BUYER_KEY") }).toEqual({ file, hits: false });
      expect({ file, hits: text.includes("packages/buyer/src/cli.ts buy") }).toEqual({ file, hits: false });
    }
  });
});
