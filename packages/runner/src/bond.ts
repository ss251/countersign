/**
 * The seller's bond commands. The key comes only from CS_SELLER_KEY.
 *
 *   bond deposit <atomic> --escrow <address> [--rpc <url>]
 *   bond withdraw <atomic> --escrow <address> [--rpc <url>]
 *   bond show --escrow <address> [--rpc <url>]
 *
 * deposit signs an EIP-3009 ReceiveWithAuthorization from the seller to the escrow, good for ten
 * minutes, and submits depositBond itself. On Arc the token domain is "USDC"/"2"; --token-name
 * and --token-version override it.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
  isAddress,
  parseSignature,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseAtomic } from "@countersign/core";

export const ARC_RPC_URL = "https://rpc.testnet.arc.network";

const bondAbi = [
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "bondOf",
    stateMutability: "view",
    inputs: [{ name: "payee", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "depositBond",
    stateMutability: "nonpayable",
    inputs: [
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawBond",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const RECEIVE_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface BondCommand {
  command: "deposit" | "withdraw" | "show";
  amount?: bigint;
  escrow: Address;
  rpcUrl: string;
  tokenName: string;
  tokenVersion: string;
}

/** Parse `bond deposit|withdraw|show ...` arguments. */
export function parseBondArgs(args: string[]): BondCommand {
  const command = args[0];
  if (command !== "deposit" && command !== "withdraw" && command !== "show") {
    throw new Error("Usage: bond <deposit|withdraw|show> [atomic] --escrow <address> [--rpc <url>]");
  }

  let index = 1;
  let amount: bigint | undefined;
  if (command !== "show") {
    const raw = args[index];
    if (raw === undefined || raw.startsWith("--")) throw new Error(`${command} needs an atomic amount.`);
    amount = parseAtomic(raw);
    if (amount === 0n) throw new Error("The amount must be positive.");
    index += 1;
  }

  let escrow: string | undefined;
  let rpcUrl = ARC_RPC_URL;
  let tokenName = "USDC";
  let tokenVersion = "2";
  for (; index < args.length; index += 1) {
    const flag = args[index] ?? "";
    const value = (): string => {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--escrow":
        escrow = value();
        break;
      case "--rpc":
        rpcUrl = value();
        break;
      case "--token-name":
        tokenName = value();
        break;
      case "--token-version":
        tokenVersion = value();
        break;
      default:
        throw new Error(`Unknown argument ${flag}.`);
    }
  }

  if (escrow === undefined) throw new Error("--escrow is required.");
  if (!isAddress(escrow)) throw new Error("--escrow must be an address.");
  return {
    command,
    ...(amount !== undefined ? { amount } : {}),
    escrow: getAddress(escrow),
    rpcUrl,
    tokenName,
    tokenVersion,
  };
}

/** Read CS_SELLER_KEY and run the parsed bond command. */
export async function bondFromEnv(args: string[], log: (line: string) => void = console.log): Promise<void> {
  const key = process.env.CS_SELLER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("CS_SELLER_KEY must hold a 0x-prefixed 32-byte hex key.");
  }
  await runBond(parseBondArgs(args), key as Hex, log);
}

/** Deposit, withdraw or show the seller's free bond on an escrow. Prints the tx hash, or the bond. */
export async function runBond(
  command: BondCommand,
  key: Hex,
  log: (line: string) => void = console.log,
): Promise<void> {
  const account = privateKeyToAccount(key);
  const probe = createPublicClient({ transport: http(command.rpcUrl) });
  const chainId = await probe.getChainId();
  const chain = defineChain({
    id: chainId,
    name: `rpc-${chainId}`,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [command.rpcUrl] } },
  });
  const pub = createPublicClient({ chain, transport: http(command.rpcUrl) });
  const wallet = createWalletClient({ chain, transport: http(command.rpcUrl), account });

  if (command.command === "show") {
    const bond = await pub.readContract({
      address: command.escrow,
      abi: bondAbi,
      functionName: "bondOf",
      args: [account.address],
    });
    log(bond.toString(10));
    return;
  }

  const amount = command.amount;
  if (amount === undefined) throw new Error(`${command.command} needs an amount.`);

  if (command.command === "withdraw") {
    const hash = await wallet.writeContract({
      address: command.escrow,
      abi: bondAbi,
      functionName: "withdrawBond",
      args: [amount],
    });
    await pub.waitForTransactionReceipt({ hash });
    log(hash);
    return;
  }

  const token = await pub.readContract({
    address: command.escrow,
    abi: bondAbi,
    functionName: "token",
  });
  const nonce = randomNonce();
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await account.signTypedData({
    domain: {
      name: command.tokenName,
      version: command.tokenVersion,
      chainId,
      verifyingContract: getAddress(token),
    },
    types: RECEIVE_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: account.address,
      to: command.escrow,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    },
  });
  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : (sig.yParity ?? 0) + 27;
  const hash = await wallet.writeContract({
    address: command.escrow,
    abi: bondAbi,
    functionName: "depositBond",
    args: [account.address, amount, validAfter, validBefore, nonce, v, sig.r, sig.s],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(hash);
}

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
