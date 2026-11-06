/**
 * countersign: one command for selling, buying and verifying. It holds no logic of its own;
 * each subcommand runs an existing CLI (docs/decisions.md D22).
 */
import { main as runnerMain } from "../../runner/src/cli.ts";

export const VERSION = "0.1.0";

export const USAGE = `countersign ${VERSION}

Sell. The runner dials out to the hub, so you open no port. The key comes from CS_SELLER_KEY.
  countersign sell skill <SKILL.md> --hub <url> --price <atomic> [runner flags]
  countersign sell openapi --spec <spec.json> --operation <id> --hub <url> --price <atomic> [--base-url <url>] [runner flags]
  Add --publish-only to list the offer without serving it.

Buy. The key comes from CS_BUYER_KEY.
  countersign discover|buy|envelope|journal [--hub <url>] [--state <dir>] ...

Verify a slip offline:
  countersign verify <slip.json> [--rpc <url>]

The buyer MCP server over stdio, from @countersign-hub/mcp:
  countersign mcp [--hub <url>] [--state <dir>] [--rpc <url>]
`;

const BUYER_COMMANDS = new Set(["discover", "buy", "envelope", "journal"]);

export interface CliDeps {
  runner: (argv: string[]) => Promise<void>;
  loadBuyer: () => Promise<unknown>;
  loadVerify: () => Promise<unknown>;
  loadMcp: () => Promise<unknown>;
}

// Built at run time, so neither the bundler nor the typecheck needs the MCP package present.
// The published name comes first; the workspace name is the fallback.
const MCP_PACKAGES = [["@countersign-hub", "mcp"].join("/"), ["@countersign", "mcp"].join("/")];

async function loadMcpPackage(): Promise<unknown> {
  let lastError: unknown = new Error("No MCP package name to try.");
  for (const name of MCP_PACKAGES) {
    try {
      return await import(name);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export const DEFAULT_DEPS: CliDeps = {
  runner: (argv) => runnerMain(argv),
  loadBuyer: () => import("../../buyer/src/cli.ts"),
  loadVerify: () => import("../../verify/src/cli.ts"),
  loadMcp: () => loadMcpPackage(),
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
      return refuse("countersign mcp needs @countersign-hub/mcp installed beside countersign.");
    }
    const main = isRecord(loaded) ? loaded.main : undefined;
    if (typeof main !== "function") return refuse("@countersign/mcp has no main(argv) export.");
    await (main as (argv: string[]) => Promise<void>)(rest);
    return;
  }
  return refuse(`countersign: unknown command '${command}'.`);
}

/** The buyer and verifier CLIs read process.argv when they load, so set it to what they expect. */
function setArgv(args: string[]): void {
  process.argv = [process.argv[0] ?? "node", "countersign", ...args];
}

function refuse(message: string): void {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exitCode = 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
