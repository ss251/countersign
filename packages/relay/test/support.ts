import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hash, Hex } from "viem";
import { NETWORK, USDT } from "../src/chain.ts";
import { SpendCeiling } from "../src/ceiling.ts";
import { authorizationToWire, signAuthorization } from "../src/eip3009.ts";
import type { Authorization } from "../src/eip3009.ts";
import type { ExactContext, PaymentRequirements, VerifyRequest } from "../src/exact.ts";
import { Ledger } from "../src/ledger.ts";
import type { ChainReader, ChainWriter, ContractCall, Receipt, SimulationCall, WriteCall } from "../src/ports.ts";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";
import { Relayer } from "../src/relayer.ts";
import type { RelayerPolicy } from "../src/relayer.ts";
import type { SpendRecord } from "../src/ledger.ts";

export const NOW = 1_760_000_000;

let hashCounter = 0;
let nonceCounter = 0;

export function fakeHash(): Hash {
  hashCounter += 1;
  return `0x${hashCounter.toString(16).padStart(64, "0")}` as Hash;
}

export function fakeNonce(): Hex {
  nonceCounter += 1;
  return `0x${nonceCounter.toString(16).padStart(64, "0")}` as Hex;
}

function nonceKey(from: string, nonce: string): string {
  return `${from.toLowerCase()}:${nonce.toLowerCase()}`;
}

export class FakeChain implements ChainReader, ChainWriter {
  balances = new Map<string, bigint>();
  used = new Set<string>();
  /** jobOf status per jobId (lowercase): 0 none, 1 funded, 2 released, 3 refunded. */
  jobs = new Map<string, number>();
  wbt = 10n ** 18n;
  maxFeePerGas = 1_000_000_000n;
  maxPriorityFeePerGas = 100_000_000n;
  gasEstimate = 100_000n;
  gasUsed = 90_000n;
  effectiveGasPrice = 1_000_000_000n;
  blockNumber = 100n;
  receiptStatus: "success" | "reverted" = "success";
  receipts = new Map<string, Receipt>();
  feeEstimate: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | null = null;
  failSimulation = false;
  timeoutReceipt = false;
  writeDelayMs = 0;
  writes: WriteCall[] = [];
  /** Throws to fail a simulation selectively. */
  simulateHook: ((call: SimulationCall) => void) | null = null;
  activeWrites = 0;
  maxConcurrentWrites = 0;

  get writer(): ChainWriter {
    return this;
  }

  setBalance(address: string, amount: bigint): void {
    this.balances.set(address.toLowerCase(), amount);
  }

  useNonce(from: string, nonce: string): void {
    this.used.add(nonceKey(from, nonce));
  }

  isUsed(from: string, nonce: string): boolean {
    return this.used.has(nonceKey(from, nonce));
  }

  async readContract(call: ContractCall): Promise<unknown> {
    const args = call.args ?? [];
    if (call.functionName === "balanceOf") {
      const owner = args[0] as string;
      return this.balances.get(owner.toLowerCase()) ?? 100_000_000n;
    }
    if (call.functionName === "authorizationState") {
      const owner = args[0] as string;
      const nonce = args[1] as string;
      return this.isUsed(owner, nonce);
    }
    if (call.functionName === "jobOf") {
      return { status: this.jobs.get((args[0] as string).toLowerCase()) ?? 0 };
    }
    throw new Error(`unexpected read: ${call.functionName}`);
  }

  async simulateContract(call: SimulationCall): Promise<unknown> {
    if (this.failSimulation) throw new Error("execution reverted");
    this.simulateHook?.(call);
    return { request: call };
  }

  async estimateContractGas(_call: SimulationCall): Promise<bigint> {
    return this.gasEstimate;
  }

  async estimateFeesPerGas(): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
    if (this.feeEstimate) return this.feeEstimate;
    return {
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas,
    };
  }

  async getBalance(_args: { address: Address }): Promise<bigint> {
    return this.wbt;
  }

  async getTransactionReceipt(args: { hash: Hash }): Promise<Receipt | null> {
    return this.receipts.get(args.hash) ?? null;
  }

  async waitForTransactionReceipt(args: {
    hash: Hash;
    timeout?: number;
  }): Promise<Receipt> {
    if (this.timeoutReceipt) {
      const error = new Error(`timed out waiting for ${args.hash}`);
      error.name = "WaitForTransactionReceiptTimeoutError";
      throw error;
    }
    return {
      status: this.receiptStatus,
      blockNumber: this.blockNumber,
      gasUsed: this.gasUsed,
      effectiveGasPrice: this.effectiveGasPrice,
    };
  }

  async writeContract(call: WriteCall): Promise<Hash> {
    this.activeWrites += 1;
    this.maxConcurrentWrites = Math.max(this.maxConcurrentWrites, this.activeWrites);
    try {
      if (this.writeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.writeDelayMs));
      }
      this.writes.push(call);
      const args = call.args ?? [];
      const from = args[0] as string | undefined;
      const nonce = args[5] as string | undefined;
      if (from && nonce) this.useNonce(from, nonce);
      return fakeHash();
    } finally {
      this.activeWrites -= 1;
    }
  }
}

export type TestRelayOptions = {
  capWei?: bigint;
  maxFeePerGasWei?: bigint;
  minBalanceWei?: bigint;
  wbt?: bigint;
  maxFeePerGas?: bigint;
  tollBps?: number;
  spends?: SpendRecord[];
  allowedPayees?: Address[];
  minAmount?: bigint;
};

export function createTestRelay(options: TestRelayOptions = {}) {
  const chain = new FakeChain();
  if (options.wbt !== undefined) chain.wbt = options.wbt;
  if (options.maxFeePerGas !== undefined) chain.maxFeePerGas = options.maxFeePerGas;

  const relayerAccount = privateKeyToAccount(generatePrivateKey());
  const buyer = privateKeyToAccount(generatePrivateKey());
  const merchant = privateKeyToAccount(generatePrivateKey());
  chain.setBalance(buyer.address, 100_000_000n);

  const ledger = new Ledger(":memory:", { tollBps: options.tollBps });
  for (const spend of options.spends ?? []) ledger.recordSpend(spend);
  const ceiling = new SpendCeiling({
    windowMs: 3_600_000,
    capWei: options.capWei ?? 10n ** 18n,
    maxTx: 100,
    maxTxPerPayer: 100,
  });
  ceiling.seed(ledger.recentSpends(Date.now() - 3_600_000));
  const policy: RelayerPolicy = {
    maxFeePerGasWei: options.maxFeePerGasWei ?? 50n * 10n ** 9n,
    minBalanceWei: options.minBalanceWei ?? 0n,
    gasHeadroomPct: 20,
    receiptTimeoutMs: 100,
    allowedTokens: [USDT.address],
    allowedEscrows: [WHITECHAIN_ESCROW],
    allowedPayees: options.allowedPayees ?? [merchant.address],
    minAmount: options.minAmount ?? 10_000n,
  };
  const relayer = new Relayer(chain, chain.writer, relayerAccount, policy, ceiling, (spend) =>
    ledger.recordSpend(spend),
  );
  const ctx: ExactContext = { reader: chain, relayer, ledger, now: () => NOW };

  return { chain, relayerAccount, buyer, merchant, ledger, ceiling, policy, relayer, ctx };
}

export function makeAuthorization(input: {
  from: Address;
  to: Address;
  value: bigint;
  validAfter?: bigint;
  validBefore?: bigint;
  nonce?: Hex;
}): Authorization {
  return {
    from: input.from,
    to: input.to,
    value: input.value,
    validAfter: input.validAfter ?? 0n,
    validBefore: input.validBefore ?? BigInt(NOW + 600),
    nonce: input.nonce ?? fakeNonce(),
  };
}

export function makeRequirements(
  payTo: Address,
  amount: bigint,
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount: amount.toString(),
    asset: USDT.address,
    payTo,
    maxTimeoutSeconds: 300,
    extra: {
      assetTransferMethod: "eip3009",
      name: "Tether USD",
      version: "1",
    },
    ...overrides,
  };
}

export async function makeVerifyBody(input: {
  signer: ReturnType<typeof privateKeyToAccount>;
  authorization: Authorization;
  requirements: PaymentRequirements;
}): Promise<VerifyRequest> {
  const signature = await signAuthorization(input.signer, input.authorization);
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: "https://merchant.example/paid",
      accepted: input.requirements,
      payload: {
        signature,
        authorization: authorizationToWire(input.authorization),
      },
    },
    paymentRequirements: input.requirements,
  };
}

export function cloneBody(body: VerifyRequest): VerifyRequest {
  return JSON.parse(JSON.stringify(body)) as VerifyRequest;
}
