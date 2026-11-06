import { describe, expect, test } from "bun:test";
import { Core } from "@walletconnect/core";
import { accountFromSession, DAPP_CORE_PREFIX, HEDERA_NAMESPACE } from "../src/dapp.ts";
import { WALLET_CORE_PREFIX } from "../src/wallet.ts";

describe("the two WalletConnect cores", () => {
  test("use different storage prefixes", () => {
    expect(WALLET_CORE_PREFIX).not.toBe(DAPP_CORE_PREFIX);
  });

  test("are different objects, so the dApp cannot inherit the wallet's core", () => {
    const wallet = new Core({ projectId: "test", customStoragePrefix: WALLET_CORE_PREFIX });
    const dapp = new Core({ projectId: "test", customStoragePrefix: DAPP_CORE_PREFIX });

    expect(wallet).not.toBe(dapp);
    expect(wallet.customStoragePrefix).not.toBe(dapp.customStoragePrefix);
  });
});

describe("the dApp's session", () => {
  test("asks for hedera:testnet and only the sign-and-execute method", () => {
    expect(HEDERA_NAMESPACE).toEqual({
      chains: ["hedera:testnet"],
      methods: ["hedera_signAndExecuteTransaction"],
      events: ["chainChanged", "accountsChanged"],
    });
  });

  test("takes the account id out of the session's CAIP-10 account", () => {
    expect(accountFromSession("hedera:testnet:0.0.5")).toBe("0.0.5");
    expect(() => accountFromSession("hedera:mainnet:0.0.5")).toThrow("Refused.");
    expect(() => accountFromSession("hedera:testnet:not-an-account")).toThrow("Refused.");
  });
});
