/**
 * Funding and balances on Arc. The arithmetic is pure so the offline tests can check it.
 */

import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { ARC } from "../../lib/chains.ts";

/** One USDC, in the token's six decimals. */
export const FUND_AMOUNT = 1_000_000n;
/** Left in the injected wallet for gas when the change goes back. */
export const GAS_RESERVE = 20_000n;

export function afterFunding(before: bigint): bigint {
  return before + FUND_AMOUNT;
}

export function afterPurchase(balance: bigint, price: bigint): bigint {
  return balance - price;
}

/** What can go back to the funder, never touching the gas reserve. */
export function changeToReturn(balance: bigint, reserve: bigint = GAS_RESERVE): bigint {
  return balance > reserve ? balance - reserve : 0n;
}

export function arcClient(rpcUrl: string = ARC.rpc) {
  return createPublicClient({ chain: ARC.chain, transport: http(rpcUrl) });
}

export async function balanceOf(client: ReturnType<typeof arcClient>, owner: Address): Promise<bigint> {
  return client.readContract({ address: ARC.token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

/** Send USDC from `account` and wait for a successful receipt. Returns the transaction hash. */
export async function transfer(
  client: ReturnType<typeof arcClient>,
  account: PrivateKeyAccount,
  to: Address,
  amount: bigint,
  rpcUrl: string = ARC.rpc,
): Promise<Hex> {
  const wallet = createWalletClient({ account, chain: ARC.chain, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({
    account,
    chain: ARC.chain,
    address: ARC.token,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 1_000 });
  if (receipt.status !== "success") throw new Error(`funding transaction ${hash} failed`);
  return hash;
}
