import { describe, expect, test } from "bun:test";
import { arcTestnet, chainName, shortAddress, walletConfig, whitechainTestnet } from "../src/lib/wallet.ts";

describe("the wallet's two chains and its one connector", () => {
  test("each chain answers to its name, and anything else to its id", () => {
    expect(chainName(5042002)).toBe("Arc testnet");
    expect(chainName(1874)).toBe("Whitechain testnet");
    expect(chainName(1)).toBe("chain 1");
    expect(chainName(undefined)).toBe("");
  });

  test("the injected connector is the only one", () => {
    expect(walletConfig.connectors).toHaveLength(1);
    expect(walletConfig.connectors[0]?.type).toBe("injected");
  });

  test("the config carries Arc testnet first and Whitechain testnet second", () => {
    expect(walletConfig.chains.map((chain) => chain.id)).toEqual([5042002, 1874]);
    expect(arcTestnet.id).toBe(5042002);
    expect(whitechainTestnet.id).toBe(1874);
  });

  test("an address shortens like every other hash", () => {
    expect(shortAddress("0x8c1f9e2b7d6a5f4e3c2b1a09f8e7d6c5b4a3a20b")).toBe("0x8c1f…a20b");
  });
});
