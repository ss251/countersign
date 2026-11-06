/**
 * Deposit USDC into the buyer's Circle Gateway balance on Arc testnet.
 *
 *   bun scripts/gateway/deposit.ts <usdc>
 *
 * The key comes from CS_BUYER_KEY and is never printed.
 */

import { GatewayClient } from "../../packages/rail/src/gateway/client.ts";

type Hex = `0x${string}`;

const amount = process.argv[2];
if (!amount || !/^\d+(\.\d+)?$/.test(amount)) {
  console.error("usage: bun scripts/gateway/deposit.ts <usdc>");
  process.exit(1);
}

const key = process.env.CS_BUYER_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("CS_BUYER_KEY must be a 0x-prefixed hex private key.");
  process.exit(1);
}

const client = new GatewayClient({ chain: "arcTestnet", privateKey: key as Hex });
const deposit = await client.deposit(amount);

console.log(`deposit tx: ${deposit.depositTxHash}`);
if (deposit.approvalTxHash) console.log(`approval tx: ${deposit.approvalTxHash}`);
console.log(`deposited: ${deposit.formattedAmount} USDC`);

const balances = await client.getBalances();
console.log(`wallet: ${balances.wallet.formatted} USDC`);
console.log(`gateway total: ${balances.gateway.formattedTotal} USDC`);
console.log(`gateway available: ${balances.gateway.formattedAvailable} USDC`);
console.log(`gateway withdrawing: ${balances.gateway.formattedWithdrawing} USDC`);
