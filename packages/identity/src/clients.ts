/**
 * Client construction for the ops scripts. The ERC-8004 functions themselves only accept
 * clients, so this is the one place that turns an RPC URL and a key into them.
 */

export {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
} from "viem";
export { privateKeyToAccount } from "viem/accounts";
export type {
  Account,
  Address,
  Chain,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";
