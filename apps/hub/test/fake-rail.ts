import type {
  EscrowOps,
  Offer,
  PaymentPayload,
  PaymentRequirements,
  Rail,
  RailDeclaration,
  Network,
  RailId,
  SettleResult,
  VerifyResult,
} from "../src/deps.ts";
import type { Hex } from "viem";

export const ASSET = "0x3600000000000000000000000000000000000000";
export const ESCROW = "0x4444444444444444444444444444444444444444";
export const CHAIN_ID = 5042002;
export const NETWORK = "eip155:5042002" as const;
export const BUYER = "0x5555555555555555555555555555555555555555";

export interface VerifyCall {
  payment: PaymentPayload;
  requirements: PaymentRequirements;
}

export interface ReleaseCall {
  jobId: Hex;
  slipHash: Hex;
  sellerSig: Hex;
}

export class FakeRail implements Rail {
  readonly declaration: RailDeclaration;
  readonly escrow?: EscrowOps;

  readonly verifyCalls: VerifyCall[] = [];
  readonly settleCalls: VerifyCall[] = [];
  readonly releaseCalls: ReleaseCall[] = [];
  readonly refundCalls: Hex[] = [];
  challengeCalls = 0;

  failVerify = false;
  failSettle = false;
  failRelease = false;
  failRefund = false;
  failChallenge = false;
  throwVerify = false;
  throwSettle = false;

  settleTx = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  releaseTx = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  refundTx = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

  constructor(id: RailId = "escrow", network: Network = NETWORK) {
    const kind = id === "escrow" ? "escrow" : "direct";
    this.declaration = {
      id,
      network,
      scheme: "countersign",
      asset: { network, address: ASSET, symbol: "USDC", decimals: 6 },
      kind,
      ...(kind === "escrow" ? { escrow: ESCROW } : {}),
      gasPaidBy: "hub",
      finality: "One Arc block after release.",
      explorerTx: "https://testnet.arcscan.app/tx/{tx}",
    };

    if (kind === "escrow") {
      this.escrow = {
        release: async (jobId, slipHash, sellerSig) => {
          this.releaseCalls.push({ jobId, slipHash, sellerSig });
          return this.result(this.failRelease, this.releaseTx);
        },
        refund: async (jobId) => {
          this.refundCalls.push(jobId);
          return this.result(this.failRefund, this.refundTx);
        },
        cancel: async () => this.result(false, this.refundTx),
        status: async () => "funded",
      };
    }
  }

  challenge(offer: Offer, _ctx: { resource: string; now: number }): PaymentRequirements {
    this.challengeCalls += 1;
    if (this.failChallenge) throw new Error("this rail cannot make a challenge");
    const requirements: PaymentRequirements = {
      scheme: "countersign",
      network: this.declaration.network,
      amount: offer.price,
      asset: ASSET,
      payTo: offer.seller,
      maxTimeoutSeconds: offer.deadline,
      extra: { escrow: ESCROW, chainId: CHAIN_ID },
    };
    return requirements;
  }

  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    this.verifyCalls.push({ payment, requirements });
    if (this.throwVerify) throw new Error("the test rail exploded\nsecond line");
    if (this.failVerify) return { isValid: false, invalidReason: "Refused. The test rail refused it." };
    return { isValid: true, payer: BUYER };
  }

  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    this.settleCalls.push({ payment, requirements });
    if (this.throwSettle) throw new Error("the test rail could not settle\nsecond line");
    if (this.failSettle) {
      return {
        success: false,
        errorReason: "Refused. The test rail could not settle.",
        transaction: this.settleTx,
        network: this.declaration.network,
      };
    }
    return {
      success: true,
      payer: BUYER,
      transaction: this.settleTx,
      network: this.declaration.network,
    };
  }

  private result(fails: boolean, tx: string): SettleResult {
    return {
      success: !fails,
      ...(fails ? { errorReason: "Refused. The test rail refused it." } : {}),
      transaction: tx,
      network: this.declaration.network,
    };
  }
}
