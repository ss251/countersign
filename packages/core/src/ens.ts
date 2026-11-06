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

/**
 * Two independent public Sepolia endpoints. The resolver asks every endpoint it is given and
 * refuses unless they agree, so no single RPC decides who a named seller is.
 */
export const DEFAULT_SEPOLIA_RPCS = ["https://11155111.rpc.thirdweb.com", "https://ethereum-sepolia-rpc.publicnode.com"];

/** The 4-byte selector of EIP-3668 `OffchainLookup(address,string[],bytes,bytes4,bytes)`. */
const OFFCHAIN_LOOKUP = "0x556f1830";

export interface SepoliaEnsOptions {
  /** One Sepolia RPC. Kept for callers that pin a single endpoint; prefer `rpcUrls`. */
  rpcUrl?: string;
  /** Sepolia RPCs that must all agree. Defaults to DEFAULT_SEPOLIA_RPCS. */
  rpcUrls?: string[];
  /** How long an answer is reused, in milliseconds. Default 60 s; 0 disables the cache. */
  cacheMs?: number;
  now?: () => number;
  /** Test seam: replaces the RPC lookups, one per endpoint. */
  lookups?: EnsResolve[];
  /** Test seam: replaces the RPC lookup. */
  lookup?: EnsResolve;
}

/** Parse a comma-separated list of RPC URLs from an environment variable, or undefined when empty. */
export function rpcUrlsFrom(value: string | undefined): string[] | undefined {
  const urls = (value ?? "").split(",").map((url) => url.trim()).filter((url) => url !== "");
  return urls.length > 0 ? urls : undefined;
}

/**
 * Forward-resolve names on Sepolia through the Universal Resolver, on every configured endpoint.
 *
 * - CCIP-Read (EIP-3668) is off. A name whose resolver answers with an OffchainLookup would
 *   otherwise make this process fetch a URL the name's owner chose. Such a name is unresolved.
 * - Every endpoint must give the same answer. A disagreement throws, which callers treat as a
 *   failed lookup and refuse.
 * - Answers, including "no address", are cached briefly. Failed lookups are not cached and throw.
 */
export function sepoliaEnsResolver(options: SepoliaEnsOptions = {}): EnsResolve {
  const lookups =
    options.lookups ??
    (options.lookup
      ? [options.lookup]
      : (options.rpcUrls ?? (options.rpcUrl ? [options.rpcUrl] : DEFAULT_SEPOLIA_RPCS)).map(rpcLookup));
  if (lookups.length === 0) throw new Error("sepoliaEnsResolver needs at least one RPC.");
  const cacheMs = options.cacheMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: Address | null; expiresAt: number }>();

  return async (name: string) => {
    const at = now();
    const hit = cache.get(name);
    if (hit && hit.expiresAt > at) return hit.value;
    const answers = await Promise.all(lookups.map((lookup) => lookup(name)));
    const first = answers[0] ?? null;
    for (const answer of answers) {
      if ((answer === null) !== (first === null) || (answer !== null && first !== null && !sameAddress(answer, first))) {
        throw new Error(`Sepolia endpoints disagree on ${name}.`);
      }
    }
    if (cacheMs > 0) cache.set(name, { value: first, expiresAt: at + cacheMs });
    return first;
  };
}

function rpcLookup(rpcUrl: string): EnsResolve {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl), ccipRead: false });
  return async (name: string) => {
    try {
      return (await client.getEnsAddress({ name: normalize(name) })) ?? null;
    } catch (error) {
      if (isOffchainLookup(error)) return null;
      throw error;
    }
  };
}

/** True when an error, or any error it wraps, carries an OffchainLookup revert. */
function isOffchainLookup(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    const e = current as { data?: unknown; raw?: unknown; cause?: unknown };
    const data = e.data as { errorName?: unknown } | string | undefined;
    if (typeof data === "object" && data !== null && data.errorName === "OffchainLookup") return true;
    for (const raw of [data, e.raw]) {
      if (typeof raw === "string" && raw.toLowerCase().startsWith(OFFCHAIN_LOOKUP)) return true;
    }
    current = e.cause;
  }
  return false;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
