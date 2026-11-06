/**
 * ERC-8004 identity and reputation on an EVM chain. Every call takes its clients from the
 * caller; this module holds no RPC endpoint, key or chain of its own.
 */

import {
  type Account,
  type Address,
  type Chain,
  getAddress,
  type Hex,
  type LocalAccount,
  parseEventLogs,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import type { Slip } from "@countersign/core";
import { identityRegistryAbi, newFeedbackEvent, reputationRegistryAbi } from "./abi.ts";

export type IdentityWallet = WalletClient<Transport, Chain, Account>;
export type IdentityPublicClient = PublicClient<Transport, Chain>;

/** The same proxies are deployed at the same addresses on Arc testnet and Hedera testnet. */
export const ARC_TESTNET_REGISTRIES = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
} as const satisfies Record<string, Address>;

export const HEDERA_TESTNET_REGISTRIES = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
} as const satisfies Record<string, Address>;

export const AGENT_WALLET_SET_TYPES = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const AGENT_WALLET_DOMAIN = { name: "ERC8004IdentityRegistry", version: "1" } as const;

/** Sign this with the new wallet; `wallet`, the owner or an operator, then sends setAgentWallet. */
export function agentWalletTypedData(
  registry: Address,
  chainId: number,
  agentId: bigint,
  newWallet: Address,
  owner: Address,
  deadline: bigint,
) {
  return {
    domain: {
      ...AGENT_WALLET_DOMAIN,
      chainId,
      verifyingContract: getAddress(registry),
    },
    types: AGENT_WALLET_SET_TYPES,
    primaryType: "AgentWalletSet" as const,
    message: {
      agentId,
      newWallet: getAddress(newWallet),
      owner: getAddress(owner),
      deadline,
    },
  };
}

export interface RegisterResult {
  agentId: bigint;
  tx: Hex;
}

export async function registerAgent(
  wallet: IdentityWallet,
  publicClient: IdentityPublicClient,
  registry: Address,
  agentURI: string,
): Promise<RegisterResult> {
  const tx = await wallet.writeContract({
    address: getAddress(registry),
    abi: identityRegistryAbi,
    functionName: "register",
    args: [agentURI],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  const logs = parseEventLogs({
    abi: identityRegistryAbi,
    eventName: "Registered",
    logs: receipt.logs.filter((log) => getAddress(log.address) === getAddress(registry)),
  });
  const found = logs[0]?.args.agentId;
  if (found === undefined) throw new Error(`no Registered log from ${getAddress(registry)} in ${tx}`);
  return { agentId: found, tx };
}

export async function grantOperator(
  wallet: IdentityWallet,
  publicClient: IdentityPublicClient,
  registry: Address,
  operator: Address,
): Promise<Hex> {
  return wallet.writeContract({
    address: getAddress(registry),
    abi: identityRegistryAbi,
    functionName: "setApprovalForAll",
    args: [getAddress(operator), true],
  });
}

export interface BindAgentWalletInput {
  wallet: IdentityWallet;
  publicClient: IdentityPublicClient;
  registry: Address;
  chainId: number;
  agentId: bigint;
  newWalletAccount: LocalAccount;
  deadline: bigint;
}

/** The new wallet signs; the owner or an approved operator sends. */
export async function bindAgentWallet(input: BindAgentWalletInput): Promise<Hex> {
  const owner = await input.publicClient.readContract({
    address: getAddress(input.registry),
    abi: identityRegistryAbi,
    functionName: "ownerOf",
    args: [input.agentId],
  });
  const signature = await input.newWalletAccount.signTypedData(
    agentWalletTypedData(
      input.registry,
      input.chainId,
      input.agentId,
      input.newWalletAccount.address,
      owner,
      input.deadline,
    ),
  );
  return input.wallet.writeContract({
    address: getAddress(input.registry),
    abi: identityRegistryAbi,
    functionName: "setAgentWallet",
    args: [input.agentId, input.newWalletAccount.address, input.deadline, signature],
  });
}

/** The feedback one released slip earns: 100/100 for the offer's rail. */
export interface Feedback {
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: Hex;
}

export function feedbackFromSlip(slip: Slip, hubUrl: string): Feedback {
  return {
    value: 100n,
    valueDecimals: 0,
    tag1: "countersign",
    tag2: slip.body.rail,
    endpoint: `${hubUrl}/offers/${slip.body.offerHash}/call`,
    feedbackURI: `${hubUrl}/slips/${slip.hash}`,
    feedbackHash: slip.hash,
  };
}

export async function giveFeedback(
  wallet: IdentityWallet,
  publicClient: IdentityPublicClient,
  registry: Address,
  agentId: bigint,
  feedback: Feedback,
): Promise<Hex> {
  return wallet.writeContract({
    address: getAddress(registry),
    abi: reputationRegistryAbi,
    functionName: "giveFeedback",
    args: [
      agentId,
      feedback.value,
      feedback.valueDecimals,
      feedback.tag1,
      feedback.tag2,
      feedback.endpoint,
      feedback.feedbackURI,
      feedback.feedbackHash,
    ],
  });
}

export interface ReadFeedback {
  client: Address;
  index: bigint;
  value: bigint;
  decimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackURI: string;
  feedbackHash: Hex;
  blockNumber: bigint;
  tx: Hex;
}

const WINDOW = 10_000n;

/** Read NewFeedback logs for one agent, 10,000 blocks at a time. */
export async function readFeedback(
  publicClient: IdentityPublicClient,
  registry: Address,
  agentId: bigint,
  fromBlock: bigint,
): Promise<ReadFeedback[]> {
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  const found: ReadFeedback[] = [];
  for (let start = fromBlock; start <= latest; start += WINDOW) {
    const end = start + WINDOW - 1n > latest ? latest : start + WINDOW - 1n;
    const logs = await publicClient.getLogs({
      address: getAddress(registry),
      event: newFeedbackEvent,
      args: { agentId },
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      const args = log.args;
      if (
        args.clientAddress === undefined ||
        args.feedbackIndex === undefined ||
        args.value === undefined ||
        args.valueDecimals === undefined ||
        args.tag1 === undefined ||
        args.tag2 === undefined ||
        args.endpoint === undefined ||
        args.feedbackURI === undefined ||
        args.feedbackHash === undefined
      ) {
        continue;
      }
      found.push({
        client: args.clientAddress,
        index: args.feedbackIndex,
        value: args.value,
        decimals: args.valueDecimals,
        tag1: args.tag1,
        tag2: args.tag2,
        endpoint: args.endpoint,
        feedbackURI: args.feedbackURI,
        feedbackHash: args.feedbackHash,
        blockNumber: log.blockNumber,
        tx: log.transactionHash,
      });
    }
  }
  return found;
}

export interface ReleasedSlip {
  hash: Hex;
  buyer: string;
}

/** Keep only feedback that names a released slip and comes from that slip's buyer. */
export function earnedFeedback<T extends Pick<ReadFeedback, "feedbackHash" | "client">>(
  feedback: readonly T[],
  releasedSlips: readonly ReleasedSlip[],
): T[] {
  const buyers = new Map<string, string>();
  for (const slip of releasedSlips) buyers.set(slip.hash.toLowerCase(), slip.buyer.toLowerCase());
  return feedback.filter((entry) => {
    const buyer = buyers.get(entry.feedbackHash.toLowerCase());
    return buyer !== undefined && buyer === entry.client.toLowerCase();
  });
}
