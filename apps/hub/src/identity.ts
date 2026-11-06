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
  /** Last identity found for a seller, so a restart does not scan from `fromBlock` again. */
  persist?: {
    get(seller: string): { registry: Address; agentId: string; block: bigint } | null;
    put(seller: string, value: { registry: Address; agentId: string; block: bigint }): void;
  };
}

const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);
const WINDOW = 10_000n;
const CACHE_MS = 10 * 60 * 1000;
const FAILURE_CACHE_MS = 30 * 1000;

interface CacheEntry {
  value: Erc8004Identity | null;
  expiresAt: number;
}

/**
 * Look up the newest ERC-8004 registration for a seller. Reads `Registered` logs in
 * 10,000-block windows from `fromBlock`, filtered on the indexed owner topic. Any RPC
 * failure is a null identity, never a failed request. A failed lookup keeps the last
 * identity it found, and is retried after 30 seconds. With `persist`, that identity is
 * read back after a restart and the next scan starts at the block where it was found.
 * A later window that contains no registration does not forget it.
 */
export function erc8004IdentityLookup(options: Erc8004IdentityOptions): IdentityLookup {
  const client = options.client ?? rpcClient(options.rpcUrl);
  const fromBlock = BigInt(options.fromBlock);
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const lastFound = new Map<string, Erc8004Identity>();
  const registryKey = options.registry.toLowerCase();

  return async (seller: string): Promise<Erc8004Identity | null> => {
    const key = seller.toLowerCase();
    const at = now();
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > at) return cached.value;

    let value: Erc8004Identity | null = null;
    let failed = false;
    let scanFrom = fromBlock;
    let persistedMatch = false;
    try {
      const row = options.persist?.get(seller) ?? null;
      if (row !== null && row.registry.toLowerCase() === registryKey) {
        persistedMatch = true;
        if (!lastFound.has(key)) {
          lastFound.set(key, { identityRegistry: options.registry, agentId: row.agentId });
        }
        if (row.block > scanFrom) scanFrom = row.block;
      }

      const latest = await client.getBlockNumber();
      let newest: RegisteredLog | null = null;
      for (let start = scanFrom; start <= latest; start += WINDOW) {
        const end = start + WINDOW - 1n > latest ? latest : start + WINDOW - 1n;
        const logs = await retryOnce(() =>
          client.getRegisteredLogs({
            registry: options.registry,
            owner: seller as Address,
            fromBlock: start,
            toBlock: end,
          }),
        );
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
        lastFound.set(key, value);
        options.persist?.put(seller, {
          registry: options.registry,
          agentId: value.agentId,
          block: newest.blockNumber,
        });
      } else if (persistedMatch) {
        value = lastFound.get(key) ?? null;
      }
    } catch {
      failed = true;
      value = lastFound.get(key) ?? null;
    }

    if (!failed && value !== null) lastFound.set(key, value);
    cache.set(key, { value, expiresAt: at + (failed ? FAILURE_CACHE_MS : CACHE_MS) });
    return value;
  };
}

async function retryOnce<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    return await call();
  }
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
