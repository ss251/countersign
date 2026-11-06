import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { erc8004IdentityLookup, type Erc8004IdentityOptions } from "../src/identity.ts";
import { Store } from "../src/store.ts";

const REGISTRY = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER_REGISTRY = "0x00000000000000000000000000000000000000cc" as Address;
const SELLER = "0x00000000000000000000000000000000000000bb" as Address;

interface Persisted {
  registry: Address;
  agentId: string;
  block: bigint;
}

function memoryPersist(initial?: Persisted) {
  const rows = new Map<string, Persisted>();
  const puts: Array<{ seller: string; value: Persisted }> = [];
  if (initial !== undefined) rows.set(SELLER, initial);
  const persist: NonNullable<Erc8004IdentityOptions["persist"]> = {
    get(seller) {
      return rows.get(seller.toLowerCase()) ?? null;
    },
    put(seller, value) {
      puts.push({ seller, value });
      rows.set(seller.toLowerCase(), value);
    },
  };
  return { persist, puts };
}

describe("erc8004 identity survives a restart", () => {
  test("a persisted row survives a client that throws", async () => {
    const { persist, puts } = memoryPersist({
      registry: REGISTRY.toUpperCase() as Address,
      agentId: "7",
      block: 4_000n,
    });
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => 1_000_000,
      persist,
      client: {
        getBlockNumber: async () => {
          throw new Error("rpc down");
        },
        getRegisteredLogs: async () => {
          throw new Error("rpc down");
        },
      },
    });

    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "7" });
    expect(puts).toHaveLength(0);
  });

  test("a persisted row starts the scan at its block", async () => {
    const block = 12_000n;
    const { persist, puts } = memoryPersist({ registry: REGISTRY, agentId: "7", block });
    const fromBlocks: bigint[] = [];
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => 1_000_000,
      persist,
      client: {
        getBlockNumber: async () => 25_000n,
        getRegisteredLogs: async (query) => {
          fromBlocks.push(query.fromBlock);
          return [];
        },
      },
    });

    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "7" });
    expect(fromBlocks[0]).toBe(block);
    expect(fromBlocks).not.toContain(0n);
    expect(puts).toHaveLength(0);
  });

  test("a newer registration is returned and saved", async () => {
    const { persist, puts } = memoryPersist({ registry: REGISTRY, agentId: "7", block: 12_000n });
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => 1_000_000,
      persist,
      client: {
        getBlockNumber: async () => 20_000n,
        getRegisteredLogs: async (query) => {
          if (query.fromBlock !== 12_000n) return [];
          return [
            { blockNumber: 12_000n, logIndex: 0, agentId: 7n, owner: SELLER },
            { blockNumber: 15_500n, logIndex: 2, agentId: 9n, owner: SELLER },
          ];
        },
      },
    });

    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "9" });
    expect(puts).toEqual([
      { seller: SELLER, value: { registry: REGISTRY, agentId: "9", block: 15_500n } },
    ]);
  });

  test("a row for a different registry is ignored", async () => {
    const { persist, puts } = memoryPersist({
      registry: OTHER_REGISTRY,
      agentId: "99",
      block: 50_000n,
    });
    const fromBlocks: bigint[] = [];
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => 1_000_000,
      persist,
      client: {
        getBlockNumber: async () => 100n,
        getRegisteredLogs: async (query) => {
          fromBlocks.push(query.fromBlock);
          return [{ blockNumber: 40n, logIndex: 0, agentId: 3n, owner: SELLER }];
        },
      },
    });

    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "3" });
    expect(fromBlocks[0]).toBe(0n);
    expect(puts).toEqual([{ seller: SELLER, value: { registry: REGISTRY, agentId: "3", block: 40n } }]);
  });

  test("the store round-trips an identity and stores the seller lowercase", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cs40-identity-")), "hub.sqlite");
    const store = new Store(path);
    const mixed = "0x000000000000000000000000000000000000aBcD";
    expect(store.getIdentity(mixed)).toBeNull();

    store.putIdentity(mixed, { registry: REGISTRY, agentId: "4", block: 42n }, 1_700_000_000);
    const stored = { registry: REGISTRY, agentId: "4", block: 42n };
    expect(store.getIdentity(mixed)).toEqual(stored);
    expect(store.getIdentity(mixed.toLowerCase())).toEqual(stored);

    store.putIdentity(mixed.toUpperCase(), { registry: REGISTRY, agentId: "8", block: 99n }, 1_700_000_100);
    const updated = { registry: REGISTRY, agentId: "8", block: 99n };
    expect(store.getIdentity(mixed)).toEqual(updated);

    const again = new Store(path);
    expect(again.getIdentity(mixed.toLowerCase())).toEqual(updated);

    const db = new Database(path, { readonly: true });
    const row = db
      .query<{ seller: string; agent_id: string; updated_at: number }, []>(
        "SELECT seller, agent_id, updated_at FROM erc8004_identities",
      )
      .get();
    expect(row?.seller).toBe(mixed.toLowerCase());
    expect(row?.agent_id).toBe("8");
    expect(row?.updated_at).toBe(1_700_000_100);
    db.close();
  });
});
