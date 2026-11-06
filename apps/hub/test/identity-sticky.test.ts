import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import {
  erc8004IdentityLookup,
  type Erc8004Identity,
  type RegisteredLog,
} from "../src/identity.ts";

const REGISTRY = "0x00000000000000000000000000000000000000aa" as Address;
const SELLER = "0x00000000000000000000000000000000000000bb" as Address;
const CACHE_MS = 10 * 60 * 1000;

function registration(agentId: bigint, owner: Address = SELLER): RegisteredLog {
  return { blockNumber: 1n, logIndex: 0, agentId, owner };
}

describe("erc8004 identity stays with the last found identity", () => {
  test("a failure keeps the last identity", async () => {
    let now = 1_000_000;
    let failing = false;
    let calls = 0;
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => now,
      client: {
        getBlockNumber: async () => 10n,
        getRegisteredLogs: async () => {
          calls += 1;
          if (failing) throw new Error("rpc down");
          return [registration(7n)];
        },
      },
    });

    const identity: Erc8004Identity = { identityRegistry: REGISTRY, agentId: "7" };
    expect(await lookup(SELLER)).toEqual(identity);

    now += CACHE_MS + 1;
    failing = true;
    const callsBeforeFailure = calls;
    expect(await lookup(SELLER)).toEqual(identity);
    expect(calls).toBeGreaterThan(callsBeforeFailure);
  });

  test("a failure is cached only 30 s", async () => {
    let now = 1_000_000;
    let failing = true;
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => now,
      client: {
        getBlockNumber: async () => 10n,
        getRegisteredLogs: async () => {
          if (failing) throw new Error("rpc down");
          return [registration(9n)];
        },
      },
    });

    expect(await lookup(SELLER)).toBeNull();

    failing = false;
    now += 10_000;
    expect(await lookup(SELLER)).toBeNull();

    now += 21_000;
    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "9" });
  });

  test("one failed window is retried", async () => {
    let calls = 0;
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => 1_000_000,
      client: {
        getBlockNumber: async () => 10n,
        getRegisteredLogs: async () => {
          calls += 1;
          if (calls === 1) throw new Error("rpc down");
          return [registration(11n)];
        },
      },
    });

    expect(await lookup(SELLER)).toEqual({ identityRegistry: REGISTRY, agentId: "11" });
    expect(calls).toBe(2);
  });

  test("a success with no registration is cached for the full lifetime", async () => {
    let now = 1_000_000;
    let calls = 0;
    const lookup = erc8004IdentityLookup({
      registry: REGISTRY,
      fromBlock: 0,
      now: () => now,
      client: {
        getBlockNumber: async () => 10n,
        getRegisteredLogs: async () => {
          calls += 1;
          return [];
        },
      },
    });

    expect(await lookup(SELLER)).toBeNull();
    now += 60_000;
    expect(await lookup(SELLER)).toBeNull();
    expect(calls).toBe(1);
  });
});
