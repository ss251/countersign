import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NOT_SIGNED_IN } from "../src/remote-signer.ts";

const cwd = join(import.meta.dir, "..");
const cli = join(cwd, "src", "cli.ts");

interface ProbeRequest {
  url: string;
  method: string;
  authorization: string | null;
}

interface Probe {
  address?: string;
  second?: string;
  error?: string;
  sessionAfter: string | null;
  requests: ProbeRequest[];
}

const PROBE = `
const requests = [];
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  requests.push({
    url: request.url,
    method: request.method,
    authorization: request.headers.get("authorization"),
  });
  if (request.url === "https://hub.test/cli/session") {
    return Response.json({ address: process.env.PROBE_ADDRESS });
  }
  return new Response("{}", { status: 500 });
};

process.argv = ["bun", "cli.ts", "journal", "--state", process.env.PROBE_STATE];

const report = {};
try {
  const { agentAccount } = await import(process.env.PROBE_CLI);
  const account = await agentAccount();
  const again = await agentAccount();
  Object.assign(report, { address: account.address, second: again.address });
} catch (error) {
  Object.assign(report, { error: error.message });
}
console.log(JSON.stringify({ ...report, sessionAfter: process.env.CS_SESSION ?? null, requests }));
`;

async function probe(env: Record<string, string>): Promise<Probe> {
  const child = Bun.spawn(["bun", "-e", PROBE], {
    cwd,
    env: {
      PATH: process.env.PATH ?? "",
      PROBE_CLI: cli,
      PROBE_STATE: mkdtempSync(join(tmpdir(), "cs-cli-session-")),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as Probe;
}

describe("the buyer CLI's account resolution", () => {
  test("a hub session gives its address and CS_SESSION is gone afterwards", async () => {
    const address = privateKeyToAccount(generatePrivateKey()).address;
    const result = await probe({
      CS_SESSION: "session-token",
      CS_HUB: "https://hub.test",
      PROBE_ADDRESS: address,
    });

    expect(result.address).toBe(address);
    expect(result.second).toBe(address);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.url).toBe("https://hub.test/cli/session");
    expect(result.requests[0]?.method).toBe("GET");
    expect(result.requests[0]?.authorization).toBe("Bearer session-token");
    expect(result.sessionAfter).toBeNull();
  });

  test("with no session and no key it throws exactly NOT_SIGNED_IN", async () => {
    const result = await probe({});

    expect(result.error).toBe(NOT_SIGNED_IN);
    expect(result.requests).toHaveLength(0);
    expect(result.sessionAfter).toBeNull();
  });

  test("CS_BUYER_KEY gives the local address and makes no fetch", async () => {
    const key = generatePrivateKey();
    const result = await probe({ CS_BUYER_KEY: key });

    expect(result.address).toBe(privateKeyToAccount(key).address);
    expect(result.second).toBe(result.address);
    expect(result.requests).toHaveLength(0);
  });
});

function literals(file: string): string[] {
  const tree = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      found.push(node.head.text);
      for (const span of node.templateSpans) found.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("no user-facing text in the buyer CLI asks for a key", () => {
  test("no string or template literal names CS_BUYER_KEY or a private key", () => {
    for (const literal of literals(cli)) {
      expect(literal.toLowerCase()).not.toContain("cs_buyer_key");
      expect(literal.toLowerCase()).not.toContain("private key");
    }
  });
});
