import { createPublicClient, http, parseAbiItem, type Address } from "viem";

export interface Erc8004Identity {
  identityRegistry: string;
  agentId: string;
}

export type IdentityLookup = (seller: string) => Promise<Erc8004Identity | null>;

export interface RegisteredLog {
  blockNumber: bigint;
  logIndex: number;
  agentId: bigint;
  owner: string;
}

export interface RegisteredLogQuery {
  registry: Address;
  owner: Address;
  fromBlock: bigint;
  toBlock: bigint;
}

export interface IdentityClient {
  getBlockNumber(): Promise<bigint>;
  getRegisteredLogs(query: RegisteredLogQuery): Promise<RegisteredLog[]>;
}

export interface Erc8004IdentityOptions {
  rpcUrl?: string;
  registry: Address;
  fromBlock: number | bigint;
  /** Test seam: when supplied, no RPC client is created. */
  client?: IdentityClient;
  now?: () => number;
}

const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const WINDOW = 10_000n;
const CACHE_MS = 10 * 60 * 1000;

interface CacheEntry {
  value: Erc8004Identity | null;
  expiresAt: number;
}

/**
 * Look up the newest ERC-8004 registration for a seller. Reads `Registered` logs in
 * 10,000-block windows from `fromBlock`, filtered on the indexed owner topic. Any RPC
 * failure is a null identity, never a failed request.
 */
export function erc8004IdentityLookup(options: Erc8004IdentityOptions): IdentityLookup {
  const client = options.client ?? rpcClient(options.rpcUrl);
  const fromBlock = BigInt(options.fromBlock);
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  return async (seller: string): Promise<Erc8004Identity | null> => {
    const key = seller.toLowerCase();
    const at = now();
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > at) return cached.value;

    let value: Erc8004Identity | null = null;
    try {
      const latest = await client.getBlockNumber();
      let newest: RegisteredLog | null = null;
      for (let start = fromBlock; start <= latest; start += WINDOW) {
        const end = start + WINDOW - 1n > latest ? latest : start + WINDOW - 1n;
        const logs = await client.getRegisteredLogs({
          registry: options.registry,
          owner: seller as Address,
          fromBlock: start,
          toBlock: end,
        });
        for (const log of logs) {
          if (log.owner.toLowerCase() !== key) continue;
          if (
            newest === null ||
            log.blockNumber > newest.blockNumber ||
            (log.blockNumber === newest.blockNumber && log.logIndex > newest.logIndex)
          ) {
            newest = log;
          }
        }
      }
      if (newest !== null) {
        value = { identityRegistry: options.registry, agentId: newest.agentId.toString() };
      }
    } catch {
      value = null;
    }

    cache.set(key, { value, expiresAt: at + CACHE_MS });
    return value;
  };
}

function rpcClient(rpcUrl: string | undefined): IdentityClient {
  if (rpcUrl === undefined) {
    throw new Error("erc8004IdentityLookup needs rpcUrl or client");
  }
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    getBlockNumber: () => client.getBlockNumber(),
    async getRegisteredLogs(query) {
      const logs = await client.getLogs({
        address: query.registry,
        event: REGISTERED_EVENT,
        args: { owner: query.owner },
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
      });
      const found: RegisteredLog[] = [];
      for (const log of logs) {
        if (log.blockNumber === null) continue;
        const { agentId, owner } = log.args;
        if (agentId === undefined || owner === undefined) continue;
        found.push({
          blockNumber: log.blockNumber,
          logIndex: log.logIndex ?? 0,
          agentId,
          owner,
        });
      }
      return found;
    },
  };
}
