import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress, verifyTypedData, type Hex } from "viem";
import { handleWalletRequest, type RpcCall } from "../lib/wallet.ts";

const KEY = `0x${"11".repeat(32)}` as Hex;
const account = privateKeyToAccount(KEY);
const OTHER = "0x2222222222222222222222222222222222222222";

const noRpc: RpcCall = async () => {
  throw new Error("rpc not expected");
};

describe("the injected wallet", () => {
  test("returns the account for both account methods", async () => {
    expect(await handleWalletRequest(account, noRpc, { method: "eth_requestAccounts" })).toEqual([account.address]);
    expect(await handleWalletRequest(account, noRpc, { method: "eth_accounts" })).toEqual([account.address]);
  });

  test("reports Arc testnet", async () => {
    expect(await handleWalletRequest(account, noRpc, { method: "eth_chainId" })).toBe("0x4cef52");
    expect(await handleWalletRequest(account, noRpc, { method: "net_version" })).toBe("5042002");
  });

  test("switches to Arc and refuses another chain", async () => {
    expect(
      await handleWalletRequest(account, noRpc, {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x4CEF52" }],
      }),
    ).toBeNull();
    expect(
      await handleWalletRequest(account, noRpc, {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      }),
    ).toEqual({ __error: { code: 4902, message: "only Arc testnet" } });
    expect(
      await handleWalletRequest(account, noRpc, {
        method: "wallet_addEthereumChain",
        params: [{ chainId: "0x1" }],
      }),
    ).toEqual({ __error: { code: 4902, message: "only Arc testnet" } });
  });

  test("personal_sign recovers to the account", async () => {
    const data = `0x${Buffer.from("hello countersign").toString("hex")}` as Hex;
    const signature = (await handleWalletRequest(account, noRpc, {
      method: "personal_sign",
      params: [data, account.address],
    })) as Hex;
    expect(await recoverMessageAddress({ message: { raw: data }, signature })).toBe(account.address);
  });

  test("eth_signTypedData_v4 verifies and drops EIP712Domain", async () => {
    const typed = {
      domain: { name: "Countersign Test", version: "1", chainId: 5042002 },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
        ],
        Job: [
          { name: "id", type: "bytes32" },
          { name: "amount", type: "uint256" },
        ],
      },
      primaryType: "Job" as const,
      message: { id: `0x${"22".repeat(32)}`, amount: "1000000" },
    };
    const signature = (await handleWalletRequest(account, noRpc, {
      method: "eth_signTypedData_v4",
      params: [account.address, JSON.stringify(typed)],
    })) as Hex;
    const { EIP712Domain: _drop, ...types } = typed.types;
    expect(
      await verifyTypedData({
        address: account.address,
        domain: typed.domain,
        types,
        primaryType: typed.primaryType,
        message: typed.message,
        signature,
      }),
    ).toBe(true);
  });

  test("refuses another address with 4100", async () => {
    expect(
      await handleWalletRequest(account, noRpc, {
        method: "personal_sign",
        params: ["0x00", OTHER],
      }),
    ).toEqual({ __error: { code: 4100, message: "unauthorized" } });
  });

  test("refuses an unknown method with 4200", async () => {
    expect(await handleWalletRequest(account, noRpc, { method: "eth_foo" })).toEqual({
      __error: { code: 4200, message: "unsupported: eth_foo" },
    });
  });

  test("forwards the read-only methods to the RPC", async () => {
    const seen: { method: string; params?: unknown }[] = [];
    const rpc: RpcCall = async (request) => {
      seen.push(request);
      return "0x2a";
    };
    expect(await handleWalletRequest(account, rpc, { method: "eth_blockNumber" })).toBe("0x2a");
    expect(seen).toEqual([{ method: "eth_blockNumber", params: undefined }]);
  });
});
