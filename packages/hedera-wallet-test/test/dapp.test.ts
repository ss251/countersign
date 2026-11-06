import { describe, expect, test } from "bun:test";
import { accountFromSession, HEDERA_NAMESPACE } from "../src/dapp.ts";

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
