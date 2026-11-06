// Publish and serve the Hedera Agent Kit as one metered MCP offer.
//   bun scripts/hedera/mcp-seller.ts --hub <url> [--price <atomic>] [--state <dir>]
// The seller key stays in the lane's key file and is never printed or accepted as an argument.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  checkSchema,
  parseAtomic,
  type JsonSchema,
  type Offer,
} from "../../packages/core/src/index.ts";
import { offerInputSchema } from "../../packages/rail/src/hedera/mcp-schema.ts";
import type { Hex, RunnerAccount } from "../../packages/runner/src/account.ts";
import { startRunner } from "../../packages/runner/src/daemon.ts";
import type { McpSpec } from "../../packages/runner/src/mcp.ts";
import { publishOffer } from "../../packages/runner/src/publish.ts";
import { key, need, readEnv } from "./env.ts";

const SELLER_ACCOUNT_ID = "0.0.11337065";
const TOOL = "transfer_hbar_tool";
const LAUNCHER = fileURLToPath(
  new URL("../../packages/rail/src/hedera/agent-kit-mcp.ts", import.meta.url),
);
const SAMPLE_INPUT = { transfers: [{ accountId: SELLER_ACCOUNT_ID, amount: 1 }] };

interface Args {
  hub: string;
  price: string;
  state: string;
}

interface AccountsModule {
  privateKeyToAccount(key: Hex): RunnerAccount;
}

interface McpTool {
  name: string;
  inputSchema: unknown;
}

interface McpClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: McpTool[] }>;
  close(): Promise<void>;
}

interface McpClientConstructor {
  new (info: { name: string; version: string }): McpClient;
}

interface StdioTransportConstructor {
  new (params: { command: string; args: string[]; stderr?: "ignore" }): unknown;
}

interface McpModules {
  Client: McpClientConstructor;
  StdioClientTransport: StdioTransportConstructor;
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  let hub: string | undefined;
  let price = "30000";
  let state = join(homedir(), ".countersign", "runner-hedera-mcp");

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? "";
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    if (flag === "--hub") hub = value();
    else if (flag === "--price") price = value();
    else if (flag === "--state") state = value();
    else throw new Error(`unknown argument ${flag}`);
  }

  if (hub === undefined) throw new Error("--hub is required");
  try {
    if (parseAtomic(price) === 0n) throw new Error("zero");
  } catch {
    throw new Error("--price must be a positive atomic amount");
  }
  return { hub, price, state };
}

async function loadAccounts(): Promise<AccountsModule> {
  const require = createRequire(new URL("../../packages/core/package.json", import.meta.url));
  const path = require.resolve("viem/accounts");
  return (await import(pathToFileURL(path).href)) as AccountsModule;
}

/** Resolve the MCP client through the runner, which declares it as a dependency. */
async function loadMcp(): Promise<McpModules> {
  const require = createRequire(new URL("../../packages/runner/package.json", import.meta.url));
  const clientPath = require.resolve("@modelcontextprotocol/sdk/client/index.js");
  const stdioPath = require.resolve("@modelcontextprotocol/sdk/client/stdio.js");
  const clientModule = (await import(pathToFileURL(clientPath).href)) as {
    Client: McpClientConstructor;
  };
  const stdioModule = (await import(pathToFileURL(stdioPath).href)) as {
    StdioClientTransport: StdioTransportConstructor;
  };
  return {
    Client: clientModule.Client,
    StdioClientTransport: stdioModule.StdioClientTransport,
  };
}

function spec(): McpSpec {
  return {
    adapter: "mcp",
    command: process.execPath,
    args: [LAUNCHER, "--account-id", "{buyer}"],
    tool: TOOL,
    server: { package: "@hashgraph/hedera-agent-kit-mcp", version: "1.2.0" },
  };
}

/** Ask the launcher itself for the tool schema, so the offer matches the live tool. */
async function inputSchema(): Promise<JsonSchema> {
  const { Client, StdioClientTransport } = await loadMcp();
  const client = new Client({ name: "countersign-mcp-seller", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [LAUNCHER, "--account-id", SELLER_ACCOUNT_ID],
    stderr: "ignore",
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === TOOL);
    if (tool === undefined) throw new Error(`the kit did not list ${TOOL}`);
    const schema = offerInputSchema(tool.inputSchema);
    try {
      const check = checkSchema(schema, SAMPLE_INPUT);
      if (!check.ok) throw new Error(check.errors.join("; "));
    } catch (error) {
      throw new Error(`the ${TOOL} input schema is unusable: ${messageOf(error)}`);
    }
    return schema;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function makeOffer(seller: Offer["seller"], price: string, input: JsonSchema): Offer {
  return {
    v: 1,
    seller,
    title: "Hedera Agent Kit: an HBAR transfer, built for you to sign",
    summary:
      "The Hedera Agent Kit's transfer_hbar_tool in RETURN_BYTES mode: the result is unsigned transaction bytes built for the paying account to sign and submit. The seller holds no key. Amounts are whole HBAR.",
    adapter: "mcp",
    input,
    output: { type: "object", required: ["tool", "server", "inputHash", "result"] },
    price,
    deadline: 120,
    bond: "0",
    rails: ["hedera"],
    payTo: { hedera: SELLER_ACCOUNT_ID },
    upstream: { url: "https://github.com/hashgraph/hedera-agent-kit-js", licence: "Apache-2.0" },
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnv();
  const raw = key(env, "HD_SELLER_KEY").toStringRaw();
  const { privateKeyToAccount } = await loadAccounts();
  const account = privateKeyToAccount(`0x${raw}` as Hex);
  if (account.address.toLowerCase() !== need(env, "HD_SELLER_EVM").toLowerCase()) {
    die("seller key does not match HD_SELLER_EVM");
  }

  const toolSpec = spec();
  const offer = makeOffer(account.address, args.price, await inputSchema());
  const skillSha256 = createHash("sha256").update(canonicalJson(toolSpec)).digest("hex");
  const published = await publishOffer(args.hub, account, offer, {
    stateDir: args.state,
    skillSha256,
  });
  console.log(published.offerHash);

  const handle = startRunner({
    hubUrl: args.hub,
    account,
    served: [{ offer: published.offer, spec: toolSpec }],
    onJob: (event) => {
      const jobId = event.jobId.length > 10 ? `${event.jobId.slice(0, 10)}…` : event.jobId;
      console.log(`${jobId} ${event.title} ${event.ok ? "ok" : event.reason ?? "refused"}`);
    },
  });

  let resolveStop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const shutdown = (): void => {
    handle.stop();
    resolveStop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await handle.ready;
  console.log("runner online");
  await stopped;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    die(messageOf(error));
  });
}
