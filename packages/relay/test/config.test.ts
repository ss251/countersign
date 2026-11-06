import { describe, expect, test } from "bun:test";
import { WHITECHAIN_RPC_URLS } from "../src/chain.ts";
import { loadRelayConfig } from "../src/config.ts";

const BASE = {
  WC_RELAYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  RELAY_DB: ":memory:",
};

describe("relay rpc urls", () => {
  test("the default list tries Ankr first and the dotted host second", () => {
    const config = loadRelayConfig(BASE);
    expect(config.rpcUrls).toEqual([
      "https://rpc.ankr.com/whitechain_testnet",
      "https://rpc.testnet.whitechain.io",
    ]);
    expect(config.rpcUrls).toEqual([...WHITECHAIN_RPC_URLS]);
    expect(config.rpcUrls[0]).toBe("https://rpc.ankr.com/whitechain_testnet");
  });

  test("the plural env overrides the list and the singular env overrides one url", () => {
    const list = loadRelayConfig({
      ...BASE,
      WHITECHAIN_RPC_URLS: "https://a.example, https://b.example",
    });
    expect(list.rpcUrls).toEqual(["https://a.example", "https://b.example"]);

    const single = loadRelayConfig({
      ...BASE,
      WHITECHAIN_RPC_URL: "https://single.example",
    });
    expect(single.rpcUrls).toEqual(["https://single.example"]);
  });

  test("the chain 2625 host is refused by name", () => {
    expect(() =>
      loadRelayConfig({ ...BASE, WHITECHAIN_RPC_URL: "https://rpc-testnet.whitechain.io" }),
    ).toThrow("2625");
    expect(() =>
      loadRelayConfig({
        ...BASE,
        WHITECHAIN_RPC_URLS: "https://rpc.ankr.com/whitechain_testnet,https://rpc-testnet.whitechain.io",
      }),
    ).toThrow("rpc-testnet.whitechain.io");
  });
});
