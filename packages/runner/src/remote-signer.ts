/**
 * The seller account for a signed-in person: every signature is made by the
 * hub through POST /cli/sign, so no seller key lives on this machine.
 */

import type { Offer } from "@countersign/core";
import { recoverMessageAddress, recoverTypedDataAddress } from "viem";
import type { Address, Hex, RunnerAccount, RunnerTypedData } from "./account.ts";

export const NOT_SIGNED_IN = "Not signed in. Run: npx -y @countersign-hub/cli login";
export const BONDED_REMOTE_REFUSAL =
  "A bonded offer cannot be served from a signed-in session yet: the hub does not sign Lock for it.";

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface RemoteSignerOptions {
  hubUrl: string;
  session: string;
  address: Address;
  fetch?: typeof fetch;
}

export interface RemoteSessionOptions {
  hubUrl: string;
  session: string;
  fetch?: typeof fetch;
}

export type RemoteRunnerAccount = RunnerAccount & { kind: "remote" };

function hubFailure(reason: number | string): Error {
  return new Error(`The hub could not sign right now (${reason}).`);
}

const WRONG_WALLET = "The hub signed with a different wallet.";

/**
 * The session token is sent only to an https hub, or to this machine for local runs: a CS_HUB that
 * names any other http:// host would receive the Bearer token in clear (cs-audit on #287, point 3).
 */
function safeHub(hubUrl: string): string {
  let url: URL;
  try {
    url = new URL(hubUrl);
  } catch {
    throw new Error("The hub address is not a URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("The session is sent only to an https hub.");
  }
  return hubUrl.replace(/\/+$/, "");
}

/** JSON-safe: every bigint at any depth becomes a decimal string. */
function decimalString(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString(10) : value;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function messageOf(body: unknown): string | null {
  const message = recordOf(body)?.message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

function codeOf(body: unknown): string | null {
  const code = recordOf(body)?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** An account whose signatures are made by the hub's session wallet. */
export function remoteRunnerAccount(options: RemoteSignerOptions): RemoteRunnerAccount {
  const hub = safeHub(options.hubUrl);
  const fetchImpl = options.fetch ?? fetch;

  // The hub's address field is only a claim: the signature itself must recover to the session
  // wallet, so a hub or Privy mix-up is a clear error here, not a bad slip later (cs-audit, #287).
  const sign = async (payload: unknown, recover: (signature: Hex) => Promise<Address>): Promise<Hex> => {
    let response: Response;
    try {
      response = await fetchImpl(`${hub}/cli/sign`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.session}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload, decimalString),
      });
    } catch {
      throw hubFailure("unreachable");
    }

    const body = await readJson(response);
    if (response.status === 200) {
      const signed = recordOf(body);
      const signature = signed?.signature;
      const address = signed?.address;
      if (
        typeof signature !== "string" ||
        !SIGNATURE.test(signature) ||
        typeof address !== "string" ||
        address.toLowerCase() !== options.address.toLowerCase()
      ) {
        throw new Error(WRONG_WALLET);
      }
      let signer: Address;
      try {
        signer = await recover(signature as Hex);
      } catch {
        throw new Error(WRONG_WALLET);
      }
      if (signer.toLowerCase() !== options.address.toLowerCase()) throw new Error(WRONG_WALLET);
      return signature as Hex;
    }
    if (response.status === 401) throw new Error(messageOf(body) ?? NOT_SIGNED_IN);
    if (response.status === 403) {
      throw new Error(`The hub refused to sign this: ${codeOf(body) ?? "not-allowed"}`);
    }
    if (response.status === 502) {
      throw new Error("The hub could not sign right now (privy-failed).");
    }
    throw hubFailure(response.status);
  };

  return {
    kind: "remote",
    address: options.address,
    signMessage: (args) =>
      sign({ kind: "message", message: args.message }, (signature) =>
        recoverMessageAddress({ message: args.message, signature }),
      ),
    signTypedData: (typedData: RunnerTypedData) =>
      sign({ kind: "typed-data", typedData }, (signature) =>
        recoverTypedDataAddress({ ...(typedData as Parameters<typeof recoverTypedDataAddress>[0]), signature }),
      ),
  };
}

/** Ask the hub who the session wallet is, then sign through it. */
export async function remoteAccountFromSession(
  options: RemoteSessionOptions,
): Promise<RemoteRunnerAccount> {
  const hub = safeHub(options.hubUrl);
  const fetchImpl = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${hub}/cli/session`, {
      headers: { authorization: `Bearer ${options.session}` },
    });
  } catch {
    throw hubFailure("unreachable");
  }

  const body = await readJson(response);
  if (response.status === 200) {
    const address = recordOf(body)?.address;
    if (typeof address !== "string" || !ADDRESS.test(address)) {
      throw hubFailure("invalid-address");
    }
    return remoteRunnerAccount({ ...options, address: address as Address });
  }
  if (response.status === 401) throw new Error(messageOf(body) ?? NOT_SIGNED_IN);
  throw hubFailure(response.status);
}

/** The hub signs no Lock for a signed-in session, so a bonded offer cannot be served remotely. */
export function assertRemoteCanServe(account: RunnerAccount, offer: Offer): void {
  if (account.kind !== "remote") return;
  let bonded = false;
  try {
    bonded = BigInt(offer.bond) > 0n;
  } catch {
    bonded = false;
  }
  if (bonded) throw new Error(BONDED_REMOTE_REFUSAL);
}
