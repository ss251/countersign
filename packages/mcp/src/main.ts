import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LocalAccount } from "viem/accounts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HubClient, Journal, remoteAccount, sessionFromEnv, State } from "@countersign/buyer";
import { createCountersignMcpServer } from "./server.ts";

const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";

const USAGE = `countersign mcp - hire a countersign offer from an MCP client (stdio)

Usage: countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]

Options:
  --hub <url>    The countersign hub (env CS_HUB; default ${DEFAULT_HUB})
  --state <dir>  Where the envelope, journal and slips live (default ~/.countersign)
  --rpc <url>    The RPC verify_slip reads the chain from (env CS_RPC_URL), e.g. https://rpc.testnet.arc.network
  --help         Print this usage and exit

Sign in once: npx -y @countersign-hub/cli login. Your agent's wallet is a Privy server wallet held for you;
this server signs through the hub with your session, and no key is ever on this machine or in any config.

CS_NETWORK must be unset or testnet.

Install: npm i -g @countersign-hub/cli, then countersign mcp (or npx -y @countersign-hub/cli mcp).
The npm packages named @countersign/*, countersign and countersign-mcp belong to other projects: never npx or npm install them.`;

interface Config {
  hub: string;
  state?: string;
  rpcUrl?: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parse(argv: string[]): { help: boolean; config: Config } {
  const config: Config = { hub: process.env.CS_HUB ?? DEFAULT_HUB };
  if (process.env.CS_RPC_URL !== undefined) config.rpcUrl = process.env.CS_RPC_URL;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i] as string;
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--hub" || argument === "--state" || argument === "--rpc") {
      const value = argv[++i];
      if (value === undefined) fail(`${argument} needs a value.`);
      if (argument === "--hub") config.hub = value;
      else if (argument === "--state") config.state = value;
      else config.rpcUrl = value;
      continue;
    }
    fail(`Unknown argument ${argument}. Run with --help for usage.`);
  }

  return { help, config };
}

export interface MainOptions {
  loadAccount?: () => Promise<LocalAccount | undefined>;
}

export interface ResolvedAccount {
  account?: LocalAccount;
  problem?: string;
}

function ciAccount(env: Record<string, string | undefined>): ResolvedAccount {
  const key = env.CS_BUYER_KEY;
  if (!key) return {};
  try {
    return { account: privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex) };
  } catch {
    return { problem: "The configured signer is not valid." };
  }
}

function sessionProblem(error: unknown): ResolvedAccount {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split("\n")[0] ?? "";
  return { problem: `Could not load the countersign session: ${firstLine}` };
}

export async function resolveAccount(
  options: MainOptions,
  env: Record<string, string | undefined>,
): Promise<ResolvedAccount> {
  if (options.loadAccount !== undefined) {
    try {
      const account = await options.loadAccount();
      return account === undefined ? {} : { account };
    } catch (error) {
      return sessionProblem(error);
    }
  }
  let session: Awaited<ReturnType<typeof sessionFromEnv>>;
  try {
    session = await sessionFromEnv(env);
  } catch (error) {
    return sessionProblem(error);
  }
  if (session !== undefined) return { account: remoteAccount(session) };
  return ciAccount(env);
}

export async function main(argv: string[], options: MainOptions = {}): Promise<void> {
  const { help, config } = parse(argv);
  if (help) {
    console.log(USAGE);
    return;
  }

  const network = process.env.CS_NETWORK;
  if (network !== undefined && network !== "" && network !== "testnet") {
    console.error("countersign-mcp is testnet only: CS_NETWORK must be unset or testnet.");
    process.exit(1);
  }

  const state = new State(config.state);
  const journal = new Journal(state.journalPath);
  const hub = new HubClient(config.hub);
  const { account, problem } = await resolveAccount(options, process.env);

  console.error(`countersign mcp: hub ${hub.url}`);
  console.error(`countersign mcp: state ${state.dir}`);
  if (account !== undefined) {
    console.error(`countersign mcp: agent ${account.address}`);
  } else {
    console.error("countersign mcp: not signed in. Run: npx -y @countersign-hub/cli login");
    if (problem !== undefined) console.error(`countersign mcp: ${problem}`);
  }

  const server = createCountersignMcpServer({
    hub,
    state,
    journal,
    hubUrl: config.hub,
    now: () => Math.floor(Date.now() / 1000),
    ...(account !== undefined ? { account } : {}),
    ...(problem !== undefined ? { problem } : {}),
    ...(config.rpcUrl !== undefined ? { rpcUrl: config.rpcUrl } : {}),
  });

  await server.connect(new StdioServerTransport());
}
