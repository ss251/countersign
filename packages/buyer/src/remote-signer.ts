import { isAddress, recoverTypedDataAddress, type Address, type Hex, type TypedDataDefinition } from "viem";
import type { CustomSource, LocalAccount } from "viem/accounts";
import { toAccount } from "viem/accounts";

export const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

export interface RemoteSession {
  hub: string;
  token: string;
  address: Address;
}

const REMOTE_ACCOUNTS = new WeakSet<object>();
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_HUB = "https://hub-production-e85e.up.railway.app";
const NOT_REACHED = "The hub could not be reached to sign.";
const TYPED_DATA_ONLY = "This wallet signs only through the hub's typed-data route.";
const HTTPS_ONLY = "Refused: the countersign hub must be https.";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertHubOrigin(hub: string): void {
  let url: URL;
  try {
    url = new URL(hub);
  } catch {
    throw new Error(HTTPS_ONLY);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return;
  throw new Error(HTTPS_ONLY);
}

interface RemoteOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface TypedDataShape {
  domain?: unknown;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

function decimalStrings(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map((entry) => decimalStrings(entry));
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = decimalStrings(entry);
    return copy;
  }
  return value;
}

function messageOf(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

export function remoteAccount(session: RemoteSession, opts: RemoteOptions = {}): LocalAccount {
  assertHubOrigin(session.hub);
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const signTypedData: CustomSource["signTypedData"] = async (parameters) => {
    const typedData = parameters as unknown as TypedDataShape;
    const types: Record<string, readonly { name: string; type: string }[]> = {};
    for (const [name, fields] of Object.entries(typedData.types)) {
      if (name !== "EIP712Domain") types[name] = fields;
    }
    const requestBody = JSON.stringify({
      kind: "typed-data",
      typedData: {
        domain: decimalStrings(typedData.domain),
        types: decimalStrings(types),
        primaryType: typedData.primaryType,
        message: decimalStrings(typedData.message),
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    let body: unknown;
    try {
      const response = await fetchImpl(`${session.hub.replace(/\/+$/, "")}/cli/sign`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: requestBody,
        signal: controller.signal,
      });
      status = response.status;
      body = await response.json().catch(() => undefined);
    } catch {
      throw new Error(NOT_REACHED);
    } finally {
      clearTimeout(timer);
    }

    if (status === 200) {
      const result = body as { signature?: unknown; address?: unknown } | undefined;
      if (
        typeof result?.address !== "string" ||
        result.address.toLowerCase() !== session.address.toLowerCase()
      ) {
        throw new Error("The hub signed with another wallet.");
      }
      const signature = result.signature;
      if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
        throw new Error(`The hub could not sign (${status}).`);
      }
      const signer = await recoverTypedDataAddress({
        ...(parameters as TypedDataDefinition),
        signature: signature as Hex,
      });
      if (signer.toLowerCase() !== session.address.toLowerCase()) {
        throw new Error("The hub signed with another wallet.");
      }
      return signature as Hex;
    }
    if (status === 401) throw new Error(NOT_SIGNED_IN);
    if (status === 403) {
      const message = messageOf(body) ?? "the hub refused the request.";
      throw new Error(`Refused by the hub: ${message}`);
    }
    if (status === 502) throw new Error("The hub could not sign (privy-failed).");
    throw new Error(`The hub could not sign (${status}).`);
  };

  const unsupported = async (): Promise<Hex> => {
    throw new Error(TYPED_DATA_ONLY);
  };

  const source: CustomSource = {
    address: session.address,
    signMessage: unsupported,
    signTransaction: unsupported,
    signTypedData,
  };
  const account = toAccount(source);
  REMOTE_ACCOUNTS.add(account);
  return account;
}

/** True for an account that signs only through the hub's typed-data route (a signed-in CLI session). */
export function isRemoteAccount(account: object): boolean {
  return REMOTE_ACCOUNTS.has(account);
}

export async function sessionFromEnv(
  env: Record<string, string | undefined> = process.env,
  opts: { fetch?: typeof fetch } = {},
): Promise<RemoteSession | undefined> {
  const token = env.CS_SESSION;
  if (token === undefined || token === "") return undefined;
  const hub = env.CS_HUB ?? DEFAULT_HUB;
  delete env.CS_SESSION;
  assertHubOrigin(hub);

  const fetchImpl = opts.fetch ?? fetch;
  let status: number;
  let body: unknown;
  try {
    const response = await fetchImpl(`${hub.replace(/\/+$/, "")}/cli/session`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    status = response.status;
    body = await response.json().catch(() => undefined);
  } catch {
    throw new Error("Could not read the countersign session (no response).");
  }

  if (status === 401) return undefined;
  if (status !== 200) throw new Error(`Could not read the countersign session (${status}).`);
  const address = (body as { address?: unknown } | undefined)?.address;
  if (typeof address !== "string" || !isAddress(address)) {
    throw new Error("The hub returned no valid wallet address.");
  }
  return { hub, token, address };
}
