/**
 * ENS seller names on Sepolia, and the payee lock they carry.
 *
 * A seller may put an ENS name in its signed offer. The name is a claim until it
 * resolves: it must resolve on Sepolia to the offer's seller, and every EVM address
 * the offer pays must be that same address. A buyer that resolves the name itself
 * therefore pays the name's address and nothing else, whatever the hub says.
 */
import { createPublicClient, http, isAddress, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";
import type { Offer } from "./types.ts";

/** The name's ETH address, or null when it has none. Throws when the lookup itself fails. */
export type EnsResolve = (name: string) => Promise<Address | null>;

export type EnsLock = { ok: true; address: Address } | { ok: false; code: EnsRefusal; message: string };
export type EnsRefusal = "ens-unavailable" | "ens-unresolved" | "ens-mismatch";

const MAX_NAME = 255;

/** True for a name already in ENS normal form (ENSIP-15) with at least two labels. */
export function isEnsName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME) return false;
  const labels = value.split(".");
  if (labels.length < 2 || labels.some((label) => label === "")) return false;
  try {
    return normalize(value) === value;
  } catch {
    return false;
  }
}

/**
 * Why the offer's EVM payees break the lock for `resolved`, or undefined when they hold.
 * Payees that are not EVM addresses, such as a Hedera account id, are outside the lock.
 */
export function ensLockProblem(offer: Offer, resolved: Address): string | undefined {
  if (!sameAddress(offer.seller, resolved)) {
    return `Refused. ${offer.ens} resolves to ${resolved}, not to the offer's seller.`;
  }
  for (const [rail, payee] of Object.entries(offer.payTo ?? {})) {
    if (typeof payee === "string" && isAddress(payee, { strict: false }) && !sameAddress(payee, resolved)) {
      return `Refused. The ${rail} payee is not the address ${offer.ens} resolves to.`;
    }
  }
  return undefined;
}

/** Resolve the offer's name with `resolve` and check the lock. An offer with no name passes. */
export async function checkEnsLock(offer: Offer, resolve: EnsResolve | undefined): Promise<EnsLock | null> {
  if (offer.ens === undefined) return null;
  if (!resolve) {
    return { ok: false, code: "ens-unavailable", message: "Refused. This offer names an ENS seller, and nothing here can check it." };
  }
  let resolved: Address | null;
  try {
    resolved = await resolve(offer.ens);
  } catch {
    return { ok: false, code: "ens-unavailable", message: `Refused. ${offer.ens} could not be looked up on Sepolia.` };
  }
  if (resolved === null) {
    return { ok: false, code: "ens-unresolved", message: `Refused. ${offer.ens} does not resolve on Sepolia.` };
  }
  const problem = ensLockProblem(offer, resolved);
  if (problem !== undefined) return { ok: false, code: "ens-mismatch", message: problem };
  return { ok: true, address: resolved };
}

export interface SepoliaEnsOptions {
  /** A Sepolia RPC. Defaults to viem's public Sepolia endpoint. */
  rpcUrl?: string;
  /** How long an answer is reused, in milliseconds. Default 60 s; 0 disables the cache. */
  cacheMs?: number;
  now?: () => number;
  /** Test seam: replaces the RPC lookup. */
  lookup?: EnsResolve;
}

/**
 * Forward-resolve names on Sepolia through the Universal Resolver. Answers, including
 * "no address", are cached briefly; failed lookups are not cached and still throw.
 */
export function sepoliaEnsResolver(options: SepoliaEnsOptions = {}): EnsResolve {
  const lookup =
    options.lookup ??
    (() => {
      const client = createPublicClient({ chain: sepolia, transport: http(options.rpcUrl) });
      return async (name: string) => (await client.getEnsAddress({ name: normalize(name) })) ?? null;
    })();
  const cacheMs = options.cacheMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: Address | null; expiresAt: number }>();

  return async (name: string) => {
    const at = now();
    const hit = cache.get(name);
    if (hit && hit.expiresAt > at) return hit.value;
    const value = await lookup(name);
    if (cacheMs > 0) cache.set(name, { value, expiresAt: at + cacheMs });
    return value;
  };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
