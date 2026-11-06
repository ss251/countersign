import { defineChain, getAddress } from "viem";
import type { Address } from "viem";

export const WHITECHAIN_CHAIN_ID = 1874;
export const NETWORK = "eip155:1874";
export const EXPLORER_URL = "https://explorer.testnet.whitechain.io";
export const WHITECHAIN_RPC_URL = "https://rpc.testnet.whitechain.io";

export const whitechainSepolia = defineChain({
  id: WHITECHAIN_CHAIN_ID,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "Whitechain", symbol: "WBT", decimals: 18 },
  rpcUrls: {
    default: { http: [WHITECHAIN_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Whitechain Explorer", url: EXPLORER_URL },
  },
  testnet: true,
});

export const USDT = {
  address: getAddress("0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7") as Address,
  name: "Tether USD",
  version: "1",
  decimals: 6,
};

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
