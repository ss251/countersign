import { spawn } from "node:child_process";
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from "viem";
import { NOT_SIGNED_IN, loadSession, type Session, type SessionBackend } from "./session.ts";

export interface LoginDeps {
  backend: SessionBackend;
  hub: string;
  write: (t: string) => void;
  fetchImpl?: typeof fetch;
  open?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  balances?: (address: string) => Promise<string>;
}

interface LoginStart {
  code: string;
  deviceSecret: string;
  verifyUrl: string;
  interval: number;
  expiresAt: number;
}

type LoginPoll =
  | { status: "pending" }
  | { status: "approved"; sessionToken: string; address: string; expiresAt: number };

const EXPIRED = "The login expired. Run countersign login again.\n";
/** The consoles whose approval page login opens by itself. Any other link is printed, never opened. */
export const CONSOLE_ORIGINS: readonly string[] = ["https://counter-sign.up.railway.app"];
const UNSAFE_URL_CHARACTERS = /[&|^<>"%`;\s]/;
const HUB_REFUSED = "Refused: the countersign hub must be https.";

/** The link to the console, or null when the hub answered with anything else. */
export function safeConsoleUrl(url: string, consoleOrigins: string | readonly string[] = CONSOLE_ORIGINS): string | null {
  if (UNSAFE_URL_CHARACTERS.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const allowed = typeof consoleOrigins === "string" ? [consoleOrigins] : consoleOrigins;
  if (!allowed.includes(parsed.origin)) return null;
  return url;
}

/** The hub origin, or a refusal: only https, plus plain http to the local machine. */
export function assertHubUrl(hub: string): string {
  let parsed: URL;
  try {
    parsed = new URL(hub);
  } catch {
    throw new Error(HUB_REFUSED);
  }
  const local =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !local) throw new Error(HUB_REFUSED);
  return parsed.origin;
}

/** Open a URL in the user's browser without waiting for it. */
function defaultOpen(url: string): void {
  const windows = process.platform === "win32";
  const command = windows ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = windows ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => {});
  child.unref();
}

function hubOrRefuse(hub: string): string | null {
  try {
    return assertHubUrl(hub);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return null;
  }
}

function expired(): void {
  process.stderr.write(EXPIRED);
  process.exitCode = 1;
}

export async function runLogin(_args: string[], deps: LoginDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const open = deps.open ?? defaultOpen;
  const hub = hubOrRefuse(deps.hub);
  if (hub === null) return;

  let start: LoginStart;
  try {
    const response = await fetchImpl(`${hub}/cli/login/start`, { method: "POST" });
    if (!response.ok) throw new Error("start refused");
    start = (await response.json()) as LoginStart;
  } catch {
    process.stderr.write("The login could not start. Run countersign login again.\n");
    process.exitCode = 1;
    return;
  }

  deps.write(`Open this link and sign in: ${start.verifyUrl}\n`);
  deps.write(`The page will show this code: ${start.code}\n`);
  const safeUrl = safeConsoleUrl(start.verifyUrl);
  if (safeUrl !== null) {
    try {
      open(safeUrl);
    } catch {}
  }

  const interval = Number.isFinite(start.interval) && start.interval > 0 ? start.interval : 5;

  while (now() < start.expiresAt) {
    await sleep(interval * 1000);
    if (now() >= start.expiresAt) break;

    let poll: LoginPoll;
    try {
      const response = await fetchImpl(`${hub}/cli/login/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceSecret: start.deviceSecret }),
      });
      if (response.status === 410) return expired();
      if (!response.ok) return expired();
      poll = (await response.json()) as LoginPoll;
    } catch {
      continue;
    }

    if (poll.status === "approved") {
      const session: Session = {
        token: poll.sessionToken,
        hub,
        address: poll.address,
        expiresAt: poll.expiresAt,
      };
      deps.backend.write(session);
      deps.write(`Signed in. Your agent wallet: ${poll.address}\n`);
      deps.write(`Fund it: send testnet USDC to ${poll.address} (Circle faucet: https://faucet.circle.com).\n`);
      deps.write(`On Whitechain you need test USDT only: the relay pays the gas.\n`);
      deps.write(`The session lasts 7 days; countersign logout ends it.\n`);
      return;
    }
    if (poll.status !== "pending") return expired();
  }

  expired();
}

export async function runLogout(_args: string[], deps: LoginDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const session = loadSession(deps.backend);
  if (session === null) {
    deps.backend.clear();
    deps.write("Not signed in.\n");
    return;
  }

  let confirmed = false;
  try {
    assertHubUrl(session.hub);
    const response = await fetchImpl(`${session.hub}/cli/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    confirmed = response.ok;
  } catch {}
  deps.backend.clear();
  if (confirmed) {
    deps.write("Signed out.\n");
  } else {
    const expiry = new Date(session.expiresAt * 1000).toISOString();
    deps.write(`Signed out here; the hub did not confirm, so the session stays valid until ${expiry}.\n`);
  }
}

export async function runWhoami(_args: string[], deps: LoginDeps): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readBalances = deps.balances ?? defaultBalances;
  const session = loadSession(deps.backend);
  if (session === null) {
    process.stderr.write(`${NOT_SIGNED_IN}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    assertHubUrl(session.hub);
  } catch {
    deps.backend.clear();
    process.stderr.write(`${NOT_SIGNED_IN}\n`);
    process.exitCode = 1;
    return;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${session.hub}/cli/session`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch {
    process.stderr.write("countersign whoami could not reach the hub.\n");
    process.exitCode = 1;
    return;
  }
  if (response.status === 401) {
    process.stderr.write(`${NOT_SIGNED_IN}\n`);
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    process.stderr.write("countersign whoami could not read the session.\n");
    process.exitCode = 1;
    return;
  }

  const body = (await response.json()) as { address: string; expiresAt: number };
  deps.write(`Signed in as ${body.address} until ${new Date(body.expiresAt * 1000).toISOString()}\n`);
  deps.write(`${await readBalances(body.address)}\n`);
}

const BALANCE_CHAINS = [
  {
    name: "Arc",
    symbol: "USDC",
    token: "0x3600000000000000000000000000000000000000" as Address,
    rpc: "https://rpc.testnet.arc.network",
  },
  {
    name: "Whitechain",
    symbol: "USDT",
    token: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" as Address,
    rpc: "https://rpc.ankr.com/whitechain_testnet",
  },
] as const;

async function defaultBalances(address: string): Promise<string> {
  const parts = await Promise.all(
    BALANCE_CHAINS.map(async (chain) => {
      try {
        const client = createPublicClient({ transport: http(chain.rpc) });
        const balance = await client.readContract({
          address: chain.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address as Address],
        });
        return `${formatUnits(balance, 6)} ${chain.symbol} on ${chain.name}`;
      } catch {
        return `unavailable ${chain.symbol} on ${chain.name}`;
      }
    }),
  );
  return parts.join(", ");
}
