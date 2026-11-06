import type { Abi, Account, Address, Chain, Hash } from "viem";

export type ContractCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

export type SimulationCall = ContractCall & { account: Account };

export type FeeEstimate = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export type Receipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice?: bigint;
};

export type WriteCall = SimulationCall & {
  chain?: Chain;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

export interface ChainReader {
  readContract(call: ContractCall): Promise<unknown>;
  simulateContract(call: SimulationCall): Promise<unknown>;
  estimateContractGas(call: SimulationCall): Promise<bigint>;
  estimateFeesPerGas(): Promise<FeeEstimate>;
  getBalance(args: { address: Address }): Promise<bigint>;
  getTransactionReceipt(args: { hash: Hash }): Promise<Receipt | null>;
  waitForTransactionReceipt(args: { hash: Hash; timeout?: number }): Promise<Receipt>;
}

export interface ChainWriter {
  writeContract(call: WriteCall): Promise<Hash>;
}
