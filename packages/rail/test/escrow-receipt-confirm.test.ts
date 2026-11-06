/**
 * A receipt that never arrives is not a failed payment when jobOf already shows the write.
 * No network: an injected public client throws from waitForTransactionReceipt, which stands in
 * for the timeout, and jobOf is whatever the case needs.
 */

import { describe, expect, test } from "bun:test";
import {
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  type CountersignExtra,
  type Offer,
  type PaymentPayload,
} from "@countersign/core";
import { escrowRail } from "../src/escrow/index.ts";
import type { Rail } from "../src/rail.ts";

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SELLER: Address = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address;
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const HASH: Hex = `0x${"ab".repeat(32)}`;
const JOB: Hex = `0x${"11".repeat(32)}`;
const SLIP: Hex = `0x${"22".repeat(32)}`;
const SIG: Hex = `0x${"33".repeat(65)}`;
const NETWORK = "eip155:5042002" as const;
const NOW = 1_000;

const offer: Offer = {
  v: 1,
  seller: SELLER,
  title: "reviewed skill",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: "1500000",
  deadline: 120,
  bond: "0",
  rails: ["escrow"],
  issuedAt: 1,
};

const pending = {
  success: false,
  errorReason: "pending",
  transaction: HASH,
  network: NETWORK,
};

interface Read {
  functionName: string;
}

function clients(options: {
  onJob: () => { status: number };
  receipt: () => { status: "success" | "reverted" } | Promise<{ status: "success" | "reverted" }>;
}): {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, LocalAccount>;
} {
  const publicClient = {
    readContract: async (input: Read) => {
      switch (input.functionName) {
        case "balanceOf":
          return 10_000_000n;
        case "authorizationState":
          return false;
        case "jobOf":
          return options.onJob();
        default:
          throw new Error(`unexpected read ${input.functionName}`);
      }
    },
    waitForTransactionReceipt: async () => options.receipt(),
  } as unknown as PublicClient<Transport, Chain>;
  const walletClient = {
    writeContract: async () => HASH,
  } as unknown as WalletClient<Transport, Chain, LocalAccount>;
  return { publicClient, walletClient };
}

function railWith(
  onJob: () => { status: number },
  receipt: () => { status: "success" | "reverted" } | Promise<{ status: "success" | "reverted" }>,
): Rail {
  const { publicClient, walletClient } = clients({ onJob, receipt });
  return escrowRail({
    id: "escrow",
    chainId: 5042002,
    rpcUrl: "http://127.0.0.1:1",
    escrow: ESCROW,
    token: TOKEN,
    tokenName: "USDC",
    tokenVersion: "2",
    symbol: "USDC",
    decimals: 6,
    explorerTx: "http://explorer/tx/{tx}",
    finality: "One block.",
    gasPaidBy: "hub",
    now: () => NOW,
    publicClient,
    walletClient,
  });
}

function timeout(): never {
  throw new Error("receipt timeout");
}

async function fundPayment(rail: Rail): Promise<PaymentPayload> {
  const req = rail.challenge(offer, { resource: "http://hub/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra;
  const input = {
    terms: {
      offerHash: extra.offerHash,
      buyer: buyer.address,
      payee: req.payTo as Address,
      amount: req.amount,
      deadline: NOW + extra.deadlineSeconds,
      salt: "7",
    },
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: req.asset as Address,
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  return {
    x402Version: 2,
    accepted: req,
    payload: countersignPayload(input, signature) as unknown as Record<string, unknown>,
  };
}

describe("escrow receipt confirm", () => {
  test("a release whose receipt wait throws is success when jobOf reads Released", async () => {
    let reads = 0;
    const rail = railWith(() => {
      reads += 1;
      return { status: 2 };
    }, timeout);
    const result = await rail.escrow!.release(JOB, SLIP, SIG);
    expect(reads).toBe(1);
    expect(result).toEqual({ success: true, transaction: HASH, network: NETWORK });
  });

  test("a release whose receipt wait throws stays pending when jobOf reads Funded", async () => {
    let reads = 0;
    const rail = railWith(() => {
      reads += 1;
      return { status: 1 };
    }, timeout);
    const result = await rail.escrow!.release(JOB, SLIP, SIG);
    expect(reads).toBe(1);
    expect(result).toEqual(pending);
  });

  test("a fund whose receipt wait throws is success when jobOf reads Funded", async () => {
    let reads = 0;
    const rail = railWith(() => {
      reads += 1;
      // verify still sees an unused job; the confirm read sees the fund.
      return { status: reads === 1 ? 0 : 1 };
    }, timeout);
    const payment = await fundPayment(rail);
    const result = await rail.settle(payment, payment.accepted);
    expect(reads).toBe(2);
    expect(result).toEqual({ success: true, transaction: HASH, network: NETWORK, payer: buyer.address });
  });

  test("a reverted receipt fails and does not confirm", async () => {
    let reads = 0;
    const rail = railWith(() => {
      reads += 1;
      return { status: 2 };
    }, () => ({ status: "reverted" }));
    const result = await rail.escrow!.release(JOB, SLIP, SIG);
    expect(reads).toBe(0);
    expect(result).toEqual({
      success: false,
      errorReason: "Refused. The chain reverted the release.",
      transaction: HASH,
      network: NETWORK,
    });
  });

  test("a jobOf read that throws during confirm is the pending failure", async () => {
    let reads = 0;
    const rail = railWith(() => {
      reads += 1;
      throw new Error("jobOf down");
    }, timeout);
    const result = await rail.escrow!.release(JOB, SLIP, SIG);
    expect(reads).toBe(1);
    expect(result).toEqual(pending);
  });
});
