/**
 * The injected test wallet: an EIP-1193 provider in the page whose key never leaves Node.
 *
 * The page calls window.__csWallet through a Playwright binding; this side signs with viem or
 * forwards the read-only call to the Arc RPC.
 */

import type { BrowserContext } from "@playwright/test";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC } from "../../lib/chains.ts";

export const ARC_CHAIN_ID = 5042002;
export const ARC_CHAIN_ID_HEX = "0x4cef52";

export interface WalletRequest {
  method: string;
  params?: unknown;
}

export interface WalletSession {
  authorized: boolean;
}

export function newWalletSession(): WalletSession {
  return { authorized: false };
}

export type RpcCall = (request: { method: string; params?: unknown }) => Promise<unknown>;

export interface WalletError {
  __error: { code: number; message: string };
}

function walletError(code: number, message: string): WalletError {
  return { __error: { code, message } };
}

function paramsOf(params: unknown): unknown[] {
  return Array.isArray(params) ? params : [];
}

function addressParam(params: unknown, index: number): string | undefined {
  const value = paramsOf(params)[index];
  return typeof value === "string" ? value : undefined;
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

function quantity(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  return undefined;
}

function isArcChain(chainId: unknown): boolean {
  if (typeof chainId === "number") return chainId === ARC_CHAIN_ID;
  if (typeof chainId !== "string") return false;
  const value = /^0x/i.test(chainId) ? Number.parseInt(chainId.slice(2), 16) : Number(chainId);
  return value === ARC_CHAIN_ID;
}

const FORWARDED = new Set([
  "eth_call",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_blockNumber",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBlockByNumber",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getCode",
  "eth_getTransactionCount",
]);

interface TransactionRequest {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
}

export function arcRpc(url: string = ARC.rpc): RpcCall {
  const client = createPublicClient({ chain: ARC.chain, transport: http(url) });
  return (request) => client.request(request as never) as Promise<unknown>;
}

async function sendTransaction(account: PrivateKeyAccount, tx: TransactionRequest, rpcUrl: string): Promise<Hex> {
  const client = createWalletClient({ account, chain: ARC.chain, transport: http(rpcUrl) });
  const value = quantity(tx.value);
  const gas = quantity(tx.gas);
  return client.sendTransaction({
    account,
    chain: ARC.chain,
    to: tx.to as Address,
    data: tx.data as Hex | undefined,
    ...(value === undefined ? {} : { value }),
    ...(gas === undefined ? {} : { gas }),
  });
}

/** The request handler behind the binding. Exported for the offline unit tests. */
export async function handleWalletRequest(
  account: PrivateKeyAccount,
  rpc: RpcCall,
  request: WalletRequest,
  rpcUrl: string = ARC.rpc,
  session: WalletSession = newWalletSession(),
): Promise<unknown> {
  const { method, params } = request;
  switch (method) {
    case "eth_requestAccounts":
      session.authorized = true;
      return [account.address];
    case "eth_accounts":
      return session.authorized ? [account.address] : [];
    case "eth_chainId":
      return ARC_CHAIN_ID_HEX;
    case "net_version":
      return String(ARC_CHAIN_ID);
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain": {
      const first = paramsOf(params)[0] as { chainId?: unknown } | undefined;
      return isArcChain(first?.chainId) ? null : walletError(4902, "only Arc testnet");
    }
    case "personal_sign": {
      const data = paramsOf(params)[0];
      if (!sameAddress(addressParam(params, 1), account.address)) return walletError(4100, "unauthorized");
      if (typeof data !== "string") return walletError(-32602, "personal_sign needs hex data");
      return account.signMessage({ message: { raw: data as Hex } });
    }
    case "eth_signTypedData_v4": {
      if (!sameAddress(addressParam(params, 0), account.address)) return walletError(4100, "unauthorized");
      const json = paramsOf(params)[1];
      if (typeof json !== "string") return walletError(-32602, "typed data needs a JSON string");
      const typed = JSON.parse(json) as {
        domain?: Record<string, unknown>;
        types?: Record<string, unknown>;
        primaryType?: string;
        message?: Record<string, unknown>;
      };
      const types = { ...(typed.types ?? {}) };
      delete types.EIP712Domain;
      return account.signTypedData({
        domain: typed.domain ?? {},
        types,
        primaryType: typed.primaryType,
        message: typed.message ?? {},
      } as unknown as Parameters<typeof account.signTypedData>[0]);
    }
    case "eth_sendTransaction": {
      const tx = paramsOf(params)[0] as TransactionRequest | undefined;
      if (!tx) return walletError(-32602, "missing transaction");
      if (!sameAddress(tx.from, account.address)) return walletError(4100, "unauthorized");
      return sendTransaction(account, tx, rpcUrl);
    }
    default:
      if (FORWARDED.has(method)) return rpc({ method, params });
      return walletError(4200, `unsupported: ${method}`);
  }
}

export function newTestAccount(): PrivateKeyAccount {
  return privateKeyToAccount(generatePrivateKey());
}

export async function installTestWallet(
  context: BrowserContext,
  account: PrivateKeyAccount,
  rpcUrl: string = ARC.rpc,
): Promise<void> {
  const rpc = arcRpc(rpcUrl);
  const session = newWalletSession();
  await context.exposeBinding("__csWallet", async (_source, request: WalletRequest) =>
    handleWalletRequest(account, rpc, request, rpcUrl, session),
  );
  await context.addInitScript(testWalletScript);
}

/**
 * Runs in the page before any application script. No values from Node are captured here: the
 * provider only knows the binding name and the public chain id.
 */
function testWalletScript(): void {
  const chainId = "0x4cef52";
  type Listener = (payload: unknown) => void;
  const listeners: Record<string, Set<Listener>> = {};
  let connected = false;

  function emit(event: string, payload: unknown): void {
    for (const listener of listeners[event] ?? []) {
      try {
        listener(payload);
      } catch {
        // a provider listener that throws must not break the page
      }
    }
  }

  const provider = {
    isCountersign: true,
    async request(args: { method: string; params?: unknown }): Promise<unknown> {
      const call = (window as unknown as { __csWallet?: (request: unknown) => Promise<unknown> }).__csWallet;
      if (!call) throw Object.assign(new Error("the test wallet is not connected"), { code: 4900 });
      const result = await call({ method: args.method, params: args.params });
      if (result !== null && typeof result === "object" && "__error" in result) {
        const error = (result as { __error: { code: number; message: string } }).__error;
        throw Object.assign(new Error(error.message), { code: error.code });
      }
      return result;
    },
    on(event: string, listener: Listener): void {
      (listeners[event] ??= new Set()).add(listener);
      if (event === "connect") {
        if (connected) queueMicrotask(() => listener({ chainId }));
      }
    },
    removeListener(event: string, listener: Listener): void {
      listeners[event]?.delete(listener);
    },
  };

  const info = Object.freeze({
    uuid: "6a1c3f2e-9b7d-4c58-8a10-2f5d7e9b4c61",
    name: "Countersign test wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23111827'/%3E%3Ctext x='16' y='22' font-family='monospace' font-size='13' fill='%23ffffff' text-anchor='middle'%3ECS%3C/text%3E%3C/svg%3E",
    rdns: "app.countersign.test",
  });

  function announce(): void {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  }

  window.addEventListener("eip6963:requestProvider", announce);
  (window as unknown as { ethereum?: unknown }).ethereum = provider;
  announce();
  setTimeout(() => {
    if (connected) return;
    connected = true;
    emit("connect", { chainId });
  }, 0);
}
