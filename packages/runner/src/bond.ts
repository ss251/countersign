/**
 * The seller's bond commands. The key comes only from CS_SELLER_KEY.
 *
 *   bond deposit <atomic> --escrow <address> [--rpc <url>]
 *   bond withdraw <atomic> --escrow <address> [--rpc <url>]
 *   bond show --escrow <address> [--rpc <url>]
 *   bond terms --offer <bytes32> --price <atomic> --bond <atomic> --review-window <seconds>
 *     --min-duration <seconds> --escrow <address> [--rpc <url>]
 *     --min-duration is the least time a funded bonded job may have before its deadline. At least 60:
 *     shorter lets a buyer fund a job the seller cannot meet and take the bond on the default. At most
 *     the offer's deadline minus about 300 s, or honest purchases revert (cs-w1, review of 9240aec).
 *   A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.
 *   bond terms --show --offer <bytes32> --escrow <address> [--rpc <url>]
 *
 * deposit signs an EIP-3009 ReceiveWithAuthorization from the seller to the escrow, good for ten
 * minutes, and submits depositBond itself. The token nonce is derived from a random salt exactly
 * as the escrow derives it, so a buyer's countersignature can never be replayed as a deposit. On
 * Arc the token domain is "USDC"/"2"; --token-name and --token-version override it.
 *
 * terms registers the only bond and window a job on one offer may carry (escrow v2, C1), and
 * --show reads that registration back.
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  isAddress,
  keccak256,
  parseSignature,
  toBytes,
  type Transport,
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
      { name: "salt", type: "bytes32" },
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

/**
 * Escrow v2's bond terms. Hand-written until Rajdeep's contract lands; the generated ABI
 * replaces this fragment then. See docs/spec/escrow.md under "Escrow v2".
 */
/** The least --min-duration `bond terms` accepts (cs-w1, review of 9240aec). */
export const MIN_DURATION_FLOOR = 60;

export const TERMS_ABI = [
  {
    type: "function",
    name: "setTerms",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerHash", type: "bytes32" },
      { name: "price", type: "uint256" },
      { name: "bond", type: "uint256" },
      { name: "reviewWindow", type: "uint64" },
      { name: "minDuration", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "termsOf",
    stateMutability: "view",
    inputs: [
      { name: "payee", type: "address" },
      { name: "offerHash", type: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "price", type: "uint256" },
          { name: "bond", type: "uint256" },
          { name: "reviewWindow", type: "uint64" },
          { name: "minDuration", type: "uint64" },
        ],
      },
    ],
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

export interface BondBaseCommand {
  escrow: Address;
  rpcUrl: string;
  tokenName: string;
  tokenVersion: string;
}

export interface BondBalanceCommand extends BondBaseCommand {
  command: "deposit" | "withdraw" | "show";
  amount?: bigint;
}

/** Escrow v2: the payee registers the only bond and window any job on one offer may carry. */
export interface BondTermsCommand extends BondBaseCommand {
  command: "terms";
  offer: Hex;
  price: bigint;
  bond: bigint;
  reviewWindow: number;
  minDuration: number;
}

export interface BondTermsShowCommand extends BondBaseCommand {
  command: "terms-show";
  offer: Hex;
}

export type BondCommand = BondBalanceCommand | BondTermsCommand | BondTermsShowCommand;

/** Parse `bond deposit|withdraw|show|terms ...` arguments. */
export function parseBondArgs(args: string[]): BondCommand {
  const command = args[0];
  if (command === "terms") return parseTermsArgs(args.slice(1));
  if (command !== "deposit" && command !== "withdraw" && command !== "show") {
    throw new Error("Usage: bond <deposit|withdraw|show|terms> ...");
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

/** `bond terms`: register one offer's price, bond, window and minimum duration. */
function parseTermsArgs(args: string[]): BondTermsCommand | BondTermsShowCommand {
  let show = false;
  let offer: string | undefined;
  let price: string | undefined;
  let bond: string | undefined;
  let reviewWindow: string | undefined;
  let minDuration: string | undefined;
  let escrow: string | undefined;
  let rpcUrl = ARC_RPC_URL;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? "";
    const value = (): string => {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--show":
        show = true;
        break;
      case "--offer":
        offer = value();
        break;
      case "--price":
        price = value();
        break;
      case "--bond":
        bond = value();
        break;
      case "--review-window":
        reviewWindow = value();
        break;
      case "--min-duration":
        minDuration = value();
        break;
      case "--escrow":
        escrow = value();
        break;
      case "--rpc":
        rpcUrl = value();
        break;
      default:
        throw new Error(`Unknown argument ${flag}.`);
    }
  }

  if (offer === undefined || !/^0x[0-9a-fA-F]{64}$/.test(offer)) {
    throw new Error("--offer must be a 32-byte hex offer hash.");
  }
  // No v2 escrow is deployed yet, so this build carries no default to fall back to.
  if (escrow === undefined) throw new Error("--escrow is required: no default escrow is set.");
  if (!isAddress(escrow)) throw new Error("--escrow must be an address.");
  const base = { escrow: getAddress(escrow), rpcUrl, tokenName: "USDC", tokenVersion: "2" };
  const offerHash = offer as Hex;
  if (show) return { command: "terms-show", offer: offerHash, ...base };

  if (bond !== undefined && reviewWindow === undefined) {
    let parsed: bigint | undefined;
    try {
      parsed = parseAtomic(bond);
    } catch {
      // Not an atomic amount. The checks below report that.
      parsed = undefined;
    }
    if (parsed !== undefined && parsed > 0n) {
      throw new Error(
        "Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.",
      );
    }
  }

  if (price === undefined || bond === undefined || reviewWindow === undefined || minDuration === undefined) {
    throw new Error("bond terms needs --offer, --price, --bond, --review-window and --min-duration (or --show).");
  }
  const parsedPrice = parseAtomic(price);
  const parsedBond = parseAtomic(bond);
  const parsedWindow = wholeSeconds(reviewWindow, "--review-window");
  assertTerms(parsedPrice, parsedBond, parsedWindow);
  const parsedMinDuration = wholeSeconds(minDuration, "--min-duration");
  if (parsedMinDuration < MIN_DURATION_FLOOR) {
    throw new Error(
      `Refused. --min-duration must be at least ${MIN_DURATION_FLOOR} seconds, or a buyer could fund a bonded job whose deadline the seller cannot meet and take the bond.`,
    );
  }
  return {
    command: "terms",
    offer: offerHash,
    price: parsedPrice,
    bond: parsedBond,
    reviewWindow: parsedWindow,
    minDuration: parsedMinDuration,
    ...base,
  };
}

function wholeSeconds(raw: string, flag: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} must be a whole number of seconds.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${flag} must be a whole number of seconds.`);
  return value;
}

/** The escrow's own setTerms guards, checked here before anything is sent. */
function assertTerms(price: bigint, bond: bigint, reviewWindow: number): void {
  if (bond > 0n && reviewWindow === 0) {
    throw new Error(
      "Refused. A bond needs --review-window above 0: a bond protects a buyer who can refuse a delivery.",
    );
  }
  if (bond > price) throw new Error("The bond cannot be more than the price.");
  if (reviewWindow > 86400) throw new Error("The review window cannot be more than 86400 seconds.");
}

/** The five arguments setTerms takes, in order. */
export type SetTermsArgs = readonly [
  offerHash: Hex,
  price: bigint,
  bond: bigint,
  reviewWindow: bigint,
  minDuration: bigint,
];

export function setTermsArgs(command: BondTermsCommand): SetTermsArgs {
  return [
    command.offer,
    command.price,
    command.bond,
    BigInt(command.reviewWindow),
    BigInt(command.minDuration),
  ];
}

/** Read CS_SELLER_KEY and run the parsed bond command. */
export async function bondFromEnv(args: string[], log: (line: string) => void = console.log): Promise<void> {
  const key = process.env.CS_SELLER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("CS_SELLER_KEY must hold a 0x-prefixed 32-byte hex key.");
  }
  await runBond(parseBondArgs(args), key as Hex, log);
}

export interface BondRunOptions {
  /** Tests: submit setTerms without a node. */
  writeTerms?: (escrow: Address, args: SetTermsArgs) => Promise<Hex>;
  /** Tests: a transport standing in for the node. */
  transport?: Transport;
}

/** Deposit, withdraw, show the free bond, or register and show the offer's terms. */
export async function runBond(
  command: BondCommand,
  key: Hex,
  log: (line: string) => void = console.log,
  options: BondRunOptions = {},
): Promise<void> {
  const account = privateKeyToAccount(key);

  if (command.command === "terms") {
    assertTerms(command.price, command.bond, command.reviewWindow);
    const args = setTermsArgs(command);
    if (options.writeTerms) {
      log(await options.writeTerms(command.escrow, args));
      return;
    }
    const { pub, wallet } = await clients(command, account, options.transport);
    const hash = await wallet.writeContract({
      address: command.escrow,
      abi: TERMS_ABI,
      functionName: "setTerms",
      args,
    });
    await pub.waitForTransactionReceipt({ hash });
    log(hash);
    return;
  }

  const { pub, wallet, chainId } = await clients(command, account, options.transport);

  if (command.command === "terms-show") {
    const terms = await pub.readContract({
      address: command.escrow,
      abi: TERMS_ABI,
      functionName: "termsOf",
      args: [account.address, command.offer],
    });
    log(formatTerms(terms));
    return;
  }

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
  const salt = randomSalt();
  const nonce = bondDepositNonce(account.address, amount, salt);
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
    args: [account.address, amount, validAfter, validBefore, salt, v, sig.r, sig.s],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(hash);
}

const BOND_DEPOSIT_TYPEHASH = keccak256(toBytes("BondDeposit(address payee,uint256 amount,bytes32 salt)"));

/** The token nonce the escrow derives from a deposit salt. */
export function bondDepositNonce(payee: Address, amount: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [BOND_DEPOSIT_TYPEHASH, payee, amount, salt],
    ),
  );
}

function randomSalt(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The public and wallet clients, over the rail's RPC or an injected transport. */
async function clients(
  command: BondCommand,
  account: ReturnType<typeof privateKeyToAccount>,
  transport?: Transport,
) {
  const wire = transport ?? http(command.rpcUrl);
  const probe = createPublicClient({ transport: wire });
  const chainId = await probe.getChainId();
  const chain = defineChain({
    id: chainId,
    name: `rpc-${chainId}`,
    nativeCurrency: { name: "native", symbol: "NATIVE", decimals: 18 },
    rpcUrls: { default: { http: [command.rpcUrl] } },
  });
  return {
    pub: createPublicClient({ chain, transport: wire }),
    wallet: createWalletClient({ chain, transport: wire, account }),
    chainId,
  };
}

/** One line of JSON, with the struct's atomic values as decimal strings. */
function formatTerms(terms: {
  price: bigint;
  bond: bigint;
  reviewWindow: bigint;
  minDuration: bigint;
}): string {
  return JSON.stringify({
    price: terms.price.toString(10),
    bond: terms.bond.toString(10),
    reviewWindow: Number(terms.reviewWindow),
    minDuration: Number(terms.minDuration),
  });
}
