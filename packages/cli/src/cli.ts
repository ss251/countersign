/**
 * countersign: one command for selling, buying and verifying. It holds no logic of its own;
 * each subcommand runs an existing CLI (docs/decisions.md D22).
 */
import { main as runnerMain } from "../../runner/src/cli.ts";
import { runLogin, runLogout, runWhoami } from "./login.ts";
import { defaultSessionBackend, loadSession, NOT_SIGNED_IN } from "./session.ts";

export const VERSION = "0.1.1";

export const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";

export const USAGE = `countersign ${VERSION}

Sell. The runner dials out to the hub, so you open no port.
  countersign sell skill <SKILL.md> --hub <url> --price <atomic> [runner flags]
  countersign sell openapi --spec <spec.json> --operation <id> --hub <url> --price <atomic> [--base-url <url>] [runner flags]
  Add --publish-only to list the offer without serving it.

Buy.
  countersign discover|buy|envelope|journal [--hub <url>] [--state <dir>] ...

Sign in, and check the session:
  countersign login|logout|whoami

Verify a slip offline:
  countersign verify <slip.json> [--rpc <url>]

The buyer MCP server over stdio:
  countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]

Start here: countersign login, then fund the printed address, then buy or sell.
The default hub is ${DEFAULT_HUB}.
`;

export const COMMAND_USAGE: Record<string, string> = {
  login: `Usage: countersign login\n  Opens a sign-in link; your agent wallet is a Privy server wallet, so no key is ever on this machine.\n`,
  logout: `Usage: countersign logout\n  Ends the session on the hub and removes the stored token.\n`,
  whoami: `Usage: countersign whoami\n  Shows the signed-in address, the session expiry and testnet balances.\n`,
  sell: `Usage: countersign sell skill <SKILL.md> --hub <url> --price <atomic> [runner flags]\n       countersign sell openapi --spec <spec.json> --operation <id> --hub <url> --price <atomic> [--base-url <url>] [runner flags]\n  Add --publish-only to list the offer without serving it.\n`,
  discover: `Usage: countersign discover [--hub <url>] [--state <dir>] [--catalogue <url|circle> [query] [--category <c>] [--limit <n>]]\n`,
  buy: `Usage: countersign buy <offerHash|callUrl> --input '<json>' [--approve] [--rail <id>] [--approvals hub] [--hub <url>] [--state <dir>]\n`,
  envelope: `Usage: countersign envelope show|set [--hub <url>] [--state <dir>]\n`,
  journal: `Usage: countersign journal [--hub <url>] [--state <dir>]\n`,
  verify: `Usage: countersign verify <slip.json> [--rpc <url>] [--mirror <url>]\n`,
  mcp: `Usage: countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]\n`,
};

const BUYER_COMMANDS = new Set(["discover", "buy", "envelope", "journal"]);

export interface CliDeps {
  runner: (argv: string[]) => Promise<void>;
  loadBuyer: () => Promise<unknown>;
  loadVerify: () => Promise<unknown>;
  loadMcp: () => Promise<unknown>;
}

/** `--hub` or `--hub=<url>` wins, then CS_HUB, then the default hub. */
export function withHub(args: string[], env: Record<string, string | undefined> = process.env): string[] {
  for (const arg of args) {
    if (arg === "--hub" || arg.startsWith("--hub=")) return args;
  }
  const hub = env.CS_HUB !== undefined && env.CS_HUB !== "" ? env.CS_HUB : DEFAULT_HUB;
  return [...args, "--hub", hub];
}

/** The CI override signs locally; otherwise a stored session becomes CS_SESSION and CS_HUB. */
export function useSession(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CS_BUYER_KEY !== undefined || env.CS_SELLER_KEY !== undefined) return true;
  const session = loadSession();
  if (session === null) return false;
  env.CS_SESSION = session.token;
  // The token goes only to the hub that issued it, whatever CS_HUB said before.
  env.CS_HUB = session.hub;
  return true;
}

export const DEFAULT_DEPS: CliDeps = {
  runner: async (argv) => {
    if (!useSession()) return requireLogin();
    await runnerMain(withHub(argv));
  },
  loadBuyer: async () => {
    if (!useSession() && needsSession()) return requireLogin();
    setArgv(withHub(process.argv.slice(2)));
    await import("../../buyer/src/cli.ts");
  },
  loadVerify: () => import("../../verify/src/cli.ts"),
  // A literal path into this repository: the bundle carries the server, and no package name is resolved.
  loadMcp: async () => {
    useSession();
    return import("../../mcp/src/main.ts");
  },
};

export type RunnerArgs = { ok: true; args: string[] } | { ok: false; error: string };

/** Map `sell <adapter> ...` onto the runner's own arguments. */
export function runnerArgs(rest: string[]): RunnerArgs {
  const publishOnly = rest.includes("--publish-only");
  const flags = rest.filter((arg) => arg !== "--publish-only");
  const verb = publishOnly ? "publish" : "serve";
  const [adapter, ...more] = flags;
  if (adapter === "skill") {
    const [path, ...others] = more;
    if (path === undefined || path.startsWith("--")) {
      return { ok: false, error: "countersign sell skill needs the path to a SKILL.md." };
    }
    return { ok: true, args: [verb, "--skill", path, ...others] };
  }
  if (adapter === "openapi") {
    const at = more.indexOf("--spec");
    const spec = at === -1 ? undefined : more[at + 1];
    if (spec === undefined || spec.startsWith("--")) {
      return { ok: false, error: "countersign sell openapi needs --spec <spec.json>." };
    }
    const others = [...more.slice(0, at), ...more.slice(at + 2)];
    return { ok: true, args: [verb, "--openapi", spec, ...others] };
  }
  if (adapter === "mcp") {
    return {
      ok: false,
      error: "countersign sell mcp is not available yet: the runner CLI sells a skill or an OpenAPI operation.",
    };
  }
  return { ok: false, error: "countersign sell takes skill or openapi." };
}

export async function run(argv: string[], deps: CliDeps = DEFAULT_DEPS): Promise<void> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`countersign ${VERSION}\n`);
    return;
  }
  const commandUsage = COMMAND_USAGE[command];
  if (commandUsage !== undefined && (rest.includes("--help") || rest.includes("-h"))) {
    process.stdout.write(commandUsage);
    return;
  }
  if (command === "login" || command === "logout" || command === "whoami") {
    const loginDeps = {
      backend: defaultSessionBackend(),
      hub: withHub([]).at(-1) as string,
      write: (t: string) => process.stdout.write(t),
    };
    if (command === "login") await runLogin(rest, loginDeps);
    else if (command === "logout") await runLogout(rest, loginDeps);
    else await runWhoami(rest, loginDeps);
    return;
  }
  if (command === "sell") {
    const mapped = runnerArgs(rest);
    if (!mapped.ok) return refuse(mapped.error);
    await deps.runner(mapped.args);
    return;
  }
  if (BUYER_COMMANDS.has(command)) {
    setArgv([command, ...rest]);
    await deps.loadBuyer();
    return;
  }
  if (command === "verify") {
    setArgv(rest);
    await deps.loadVerify();
    return;
  }
  if (command === "mcp") {
    let loaded: unknown;
    try {
      loaded = await deps.loadMcp();
    } catch {
      return refuse("countersign mcp could not load its MCP server.");
    }
    const main = isRecord(loaded) ? loaded.main : undefined;
    if (typeof main !== "function") return refuse("The MCP server has no main(argv) export.");
    await (main as (argv: string[]) => Promise<void>)(rest);
    return;
  }
  return refuse(`countersign: unknown command '${command}'.`);
}

/** The buyer and verifier CLIs read process.argv when they load, so set it to what they expect. */
function setArgv(args: string[]): void {
  process.argv = [process.argv[0] ?? "node", "countersign", ...args];
}

/** Only these buyer paths need a session; discovery and a local envelope check stay open. */
function needsSession(): boolean {
  const [command, verb] = process.argv.slice(2);
  return command === "buy" || command === "journal" || (command === "envelope" && verb === "set");
}

function requireLogin(): void {
  process.stderr.write(`${NOT_SIGNED_IN}\n`);
  process.exitCode = 1;
}

function refuse(message: string): void {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exitCode = 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
