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

/** Open a URL in the user's browser without waiting for it. */
function defaultOpen(url: string): void {
  let command = "xdg-open";
  let args = [url];
  if (process.platform === "darwin") {
    command = "open";
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
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

  let start: LoginStart;
  try {
    const response = await fetchImpl(`${deps.hub}/cli/login/start`, { method: "POST" });
    if (!response.ok) throw new Error("start refused");
    start = (await response.json()) as LoginStart;
  } catch {
    process.stderr.write("The login could not start. Run countersign login again.\n");
    process.exitCode = 1;
    return;
  }

  deps.write(`Open this link and sign in: ${start.verifyUrl}\n`);
  deps.write(`The page will show this code: ${start.code}\n`);
  try {
    open(start.verifyUrl);
  } catch {}

  const interval = Number.isFinite(start.interval) && start.interval > 0 ? start.interval : 5;

  while (now() < start.expiresAt) {
    await sleep(interval * 1000);
    if (now() >= start.expiresAt) break;

    let poll: LoginPoll;
    try {
      const response = await fetchImpl(`${deps.hub}/cli/login/poll`, {
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
        hub: deps.hub,
        address: poll.address,
        expiresAt: poll.expiresAt,
      };
      deps.backend.write(session);
      deps.write(`Signed in. Your agent wallet: ${poll.address}\n`);
      deps.write(`Fund it: send testnet USDC to ${poll.address} (Circle faucet: https://faucet.circle.com).\n`);
      deps.write(`For Whitechain, get test WBT for gas at https://faucet.testnet.whitechain.io.\n`);
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
  if (session !== null) {
    try {
      await fetchImpl(`${deps.hub}/cli/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {}
  }
  deps.backend.clear();
  deps.write(session === null ? "Not signed in.\n" : "Signed out.\n");
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

  let response: Response;
  try {
    response = await fetchImpl(`${deps.hub}/cli/session`, {
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
