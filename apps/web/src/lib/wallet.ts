import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { shortHex } from "./format.ts";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const whitechainTestnet = defineChain({
  id: 1874,
  name: "Whitechain testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  testnet: true,
});

export const walletConfig = createConfig({
  chains: [arcTestnet, whitechainTestnet],
  connectors: [injected()],
  multiInjectedProviderDiscovery: false,
  transports: {
    [arcTestnet.id]: http(),
    [whitechainTestnet.id]: http(),
  },
});

export const PRIVY_APP_ID: string | undefined =
  import.meta.env.VITE_PRIVY_APP_ID?.trim() || undefined;

export type WalletMode = { privy: boolean; reason: string | null };

export const PRIVY_NOT_SET_UP =
  "Email sign-in is not set up on this console, so connect a browser wallet.";

export function walletModeFor(appId: string | undefined, failed: string | null): WalletMode {
  if (!appId) return { privy: false, reason: PRIVY_NOT_SET_UP };
  if (failed) return { privy: false, reason: failed };
  return { privy: true, reason: null };
}

export function chainName(id: number | undefined): string {
  if (id === undefined) return "";
  return walletConfig.chains.find((chain) => chain.id === id)?.name ?? `chain ${id}`;
}

export function shortAddress(a: string): string {
  return shortHex(a);
}
