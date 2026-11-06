import { parseSignature } from "viem";
import type { Address, Hash, Hex, LocalAccount } from "viem";
import { escrowAbi, fundArgs } from "@countersign/rail";
import type { CountersignPayload } from "@countersign/core";
import { whitechainSepolia } from "./chain.ts";
import type { CeilingRefusal, CeilingSnapshot, SpendCeiling } from "./ceiling.ts";
import { tokenAbi } from "./eip3009.ts";
import type { Authorization } from "./eip3009.ts";
import type { ChainReader, ChainWriter, ContractCall } from "./ports.ts";

export type RelayerPolicy = {
  maxFeePerGasWei: bigint;
  minBalanceWei: bigint;
  gasHeadroomPct: number;
  receiptTimeoutMs: number;
  allowedTokens: Address[];
  allowedEscrows: Address[];
};

export type TransferCall = {
  kind: "transferWithAuthorization";
  token: Address;
  auth: Authorization;
  signature: Hex;
};

export type EscrowFundCall = {
  kind: "escrowFund";
  escrow: Address;
  offerHash: Hex;
  payload: CountersignPayload;
};

export type EscrowReleaseCall = {
  kind: "escrowRelease";
  escrow: Address;
  jobId: Hex;
  slipHash: Hex;
  sellerSig: Hex;
};

export type EscrowCancelCall = {
  kind: "escrowCancel";
  escrow: Address;
  jobId: Hex;
  sellerSig: Hex;
};

export type EscrowRefundCall = {
  kind: "escrowRefund";
  escrow: Address;
  jobId: Hex;
};

export type EscrowCall = EscrowFundCall | EscrowReleaseCall | EscrowCancelCall | EscrowRefundCall;

export type RelayCall = TransferCall | EscrowCall;

export type RelayRefusalReason =
  | "not_allowed"
  | "simulation_failed"
  | "fee_too_high"
  | CeilingRefusal
  | "balance_floor";

export type RelayOutcome =
  | { status: "refused"; reason: RelayRefusalReason; detail?: string }
  | {
      status: "confirmed";
      txHash: Hash;
      blockNumber: bigint;
      gasUsed: bigint;
      costWei: bigint;
    }
  | {
      status: "reverted";
      txHash: Hash;
      blockNumber: bigint;
      gasUsed: bigint;
      costWei: bigint;
    }
  | { status: "pending"; txHash: Hash };

export type RelayerStatus = {
  address: Address;
  balanceWei: bigint;
  ceiling: CeilingSnapshot;
  policy: RelayerPolicy;
};

export type SimulationResult = { ok: true; gas: bigint } | { ok: false; detail: string };

export class Relayer {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly reader: ChainReader,
    private readonly writer: ChainWriter,
    private readonly account: LocalAccount,
    private readonly policy: RelayerPolicy,
    private readonly ceiling: SpendCeiling,
  ) {}

  get address(): Address {
    return this.account.address;
  }

  get allowedEscrows(): Address[] {
    return this.policy.allowedEscrows;
  }

  private allowed(call: RelayCall): boolean {
    if (call.kind === "transferWithAuthorization") {
      return this.policy.allowedTokens.some((token) => sameAddress(token, call.token));
    }
    return this.policy.allowedEscrows.some((escrow) => sameAddress(escrow, call.escrow));
  }

  async simulate(call: RelayCall): Promise<SimulationResult> {
    try {
      const contractCall = toContractCall(call);
      await this.reader.simulateContract({ ...contractCall, account: this.account });
      const gas = await this.reader.estimateContractGas({
        ...contractCall,
        account: this.account,
      });
      return { ok: true, gas };
    } catch (error) {
      return { ok: false, detail: describeError(error) };
    }
  }

  async submit(call: RelayCall, payer: Address): Promise<RelayOutcome> {
    return this.exclusive(() => this.submitUnlocked(call, payer));
  }

  exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async submitUnlocked(call: RelayCall, payer: Address): Promise<RelayOutcome> {
    if (!this.allowed(call)) {
      return { status: "refused", reason: "not_allowed" };
    }

    const simulation = await this.simulate(call);
    if (!simulation.ok) {
      return { status: "refused", reason: "simulation_failed", detail: simulation.detail };
    }

    let fees;
    try {
      fees = await this.reader.estimateFeesPerGas();
    } catch (error) {
      return { status: "refused", reason: "fee_too_high", detail: describeError(error) };
    }
    const maxFeePerGas = fees.maxFeePerGas ?? 0n;
    const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? maxFeePerGas;
    if (maxFeePerGas > this.policy.maxFeePerGasWei) {
      return { status: "refused", reason: "fee_too_high" };
    }

    const gasWithHeadroom =
      (simulation.gas * BigInt(100 + this.policy.gasHeadroomPct)) / 100n;
    const worstCaseWei = gasWithHeadroom * maxFeePerGas;
    const reservation = this.ceiling.reserve({ payer, worstCaseWei });
    if (!reservation.ok) {
      return { status: "refused", reason: reservation.reason };
    }
    const ticket = reservation.ticket;

    let balanceWei: bigint;
    try {
      balanceWei = await this.reader.getBalance({ address: this.account.address });
    } catch (error) {
      this.ceiling.cancel(ticket);
      return { status: "refused", reason: "balance_floor", detail: describeError(error) };
    }
    if (balanceWei - worstCaseWei < this.policy.minBalanceWei) {
      this.ceiling.cancel(ticket);
      return { status: "refused", reason: "balance_floor" };
    }

    let txHash: Hash;
    try {
      txHash = await this.writer.writeContract({
        ...toContractCall(call),
        account: this.account,
        chain: whitechainSepolia,
        gas: gasWithHeadroom,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
    } catch (error) {
      this.ceiling.cancel(ticket);
      return { status: "refused", reason: "simulation_failed", detail: describeError(error) };
    }

    try {
      const receipt = await this.reader.waitForTransactionReceipt({
        hash: txHash,
        timeout: this.policy.receiptTimeoutMs,
      });
      const effectiveGasPrice = receipt.effectiveGasPrice ?? maxFeePerGas;
      const costWei = receipt.gasUsed * effectiveGasPrice;
      this.ceiling.settle(ticket, costWei);
      return {
        status: receipt.status === "success" ? "confirmed" : "reverted",
        txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        costWei,
      };
    } catch {
      return { status: "pending", txHash };
    }
  }

  async status(): Promise<RelayerStatus> {
    const balanceWei = await this.reader.getBalance({ address: this.account.address });
    return {
      address: this.account.address,
      balanceWei,
      ceiling: this.ceiling.snapshot(),
      policy: this.policy,
    };
  }
}

function toContractCall(call: RelayCall): ContractCall {
  switch (call.kind) {
    case "transferWithAuthorization": {
      const signature = parseSignature(call.signature);
      const v = signature.v ?? BigInt((signature.yParity ?? 0) + 27);
      return {
        address: call.token,
        abi: tokenAbi,
        functionName: "transferWithAuthorization",
        args: [
          call.auth.from,
          call.auth.to,
          call.auth.value,
          call.auth.validAfter,
          call.auth.validBefore,
          call.auth.nonce,
          v,
          signature.r,
          signature.s,
        ],
      };
    }
    case "escrowFund":
      return {
        address: call.escrow,
        abi: escrowAbi,
        functionName: "fund",
        args: fundArgs(call.offerHash, call.payload),
      };
    case "escrowRelease":
      return {
        address: call.escrow,
        abi: escrowAbi,
        functionName: "release",
        args: [call.jobId, call.slipHash, call.sellerSig],
      };
    case "escrowCancel":
      return {
        address: call.escrow,
        abi: escrowAbi,
        functionName: "cancel",
        args: [call.jobId, call.sellerSig],
      };
    case "escrowRefund":
      return {
        address: call.escrow,
        abi: escrowAbi,
        functionName: "refund",
        args: [call.jobId],
      };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
