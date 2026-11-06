import type { Address, Hex } from "viem";
import type { CustomSource, LocalAccount } from "viem/accounts";
import { toAccount } from "viem/accounts";

export const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";

export interface RemoteSession {
  hub: string;
  token: string;
  address: Address;
}

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const DEFAULT_TIMEOUT_MS = 30_000;
const NOT_REACHED = "The hub could not be reached to sign.";
const TYPED_DATA_ONLY = "This wallet signs only through the hub's typed-data route.";

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
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const signTypedData: CustomSource["signTypedData"] = async (parameters) => {
    const typedData = parameters as unknown as TypedDataShape;
    const types: Record<string, readonly { name: string; type: string }[]> = {};
    for (const [name, fields] of Object.entries(typedData.types)) {
      if (name !== "EIP712Domain") types[name] = fields;
    }
    const requestBody = JSON.stringify({
      kind: "evm",
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
      const signature = (body as { signature?: unknown } | undefined)?.signature;
      if (typeof signature === "string" && SIGNATURE.test(signature)) return signature as Hex;
      throw new Error(`The hub could not sign (${status}).`);
    }
    if (status === 401) throw new Error(NOT_SIGNED_IN);
    if (status === 403) {
      const message = messageOf(body) ?? "the hub refused the request.";
      throw new Error(`Refused by the hub: ${message}`);
    }
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
  return toAccount(source);
}
