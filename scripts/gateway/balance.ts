/**
 * Print Circle Gateway balances on Arc testnet.
 *
 *   bun scripts/gateway/balance.ts [address]
 *
 * Without an address it prints the CS_BUYER_KEY account's balances. The key is
 * never printed.
 */

import { GatewayClient } from "../../packages/rail/src/gateway/client.ts";

type Address = `0x${string}`;
type Hex = `0x${string}`;

const arg = process.argv[2];
if (arg && !/^0x[0-9a-fA-F]{40}$/.test(arg)) {
  console.error(`not an address: ${arg}`);
  process.exit(1);
}

const key = process.env.CS_BUYER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("CS_BUYER_KEY must be a 0x-prefixed hex private key.");
  process.exit(1);
}

const client = new GatewayClient({ chain: "arcTestnet", privateKey: key as Hex });
const address = (arg as Address | undefined) ?? client.address;
const balances = await client.getBalances(address);

console.log(`address: ${address}`);
console.log(`wallet: ${balances.wallet.formatted} USDC`);
console.log(`gateway total: ${balances.gateway.formattedTotal} USDC`);
console.log(`gateway available: ${balances.gateway.formattedAvailable} USDC`);
console.log(`gateway withdrawing: ${balances.gateway.formattedWithdrawing} USDC`);
console.log(`gateway withdrawable: ${balances.gateway.formattedWithdrawable} USDC`);
