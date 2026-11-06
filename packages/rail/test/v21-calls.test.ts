/**
 * Escrow v2.1 on the rail: fund carries the payee's Lock signature and dispute names the
 * job's status. No network: the contract calls are encoded through viem and captured from
 * an injected wallet.
 */

import { describe, expect, test } from "bun:test";
import {
  type Address,
  type Chain,
  encodeFunctionData,
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
  type CountersignTerms,
  type Offer,
  type PaymentPayload,
} from "@countersign/core";
import { escrowV2Abi } from "../src/escrow/abi-v2.ts";
import { escrowRail, fundArgsV2 } from "../src/escrow/index.ts";
import type { Rail } from "../src/rail.ts";

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SELLER: Address = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a").address;
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const TX: Hex = `0x${"ab".repeat(32)}`;
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
  bond: "500000",
  rails: ["escrow"],
  issuedAt: 1,
};
const reviewedOffer = { ...offer, reviewWindow: 300 } as Offer;

interface WriteCall {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

function fakePublic(): PublicClient<Transport, Chain> {
  return {
    readContract: async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "balanceOf":
          return 10_000_000n;
        case "authorizationState":
          return false;
        case "jobOf":
          return { status: 0 };
        default:
          throw new Error(`unexpected read ${input.functionName}`);
      }
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient<Transport, Chain>;
}

function fakeWallet(calls: WriteCall[]): WalletClient<Transport, Chain, LocalAccount> {
  return {
    writeContract: async (input: WriteCall) => {
      calls.push(input);
      return TX;
    },
  } as unknown as WalletClient<Transport, Chain, LocalAccount>;
}

function railWith(writes: WriteCall[]): Rail {
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
    version: 2,
    now: () => NOW,
    publicClient: fakePublic(),
    walletClient: fakeWallet(writes),
  });
}

async function signed(rail: Rail) {
  const req = rail.challenge(reviewedOffer, { resource: "http://hub/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra & { bond?: string; reviewWindow?: number };
  const terms: CountersignTerms = {
    offerHash: extra.offerHash,
    buyer: buyer.address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: "7",
    bond: extra.bond ?? "0",
    reviewWindow: extra.reviewWindow ?? 0,
  };
  const input = {
    terms,
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: req.asset as Address,
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: NOW + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: req,
    payload: payload as unknown as Record<string, unknown>,
  };
  return { payment, payload };
}

function encoded(call: WriteCall): Hex {
  return encodeFunctionData({
    abi: call.abi as typeof escrowV2Abi,
    functionName: call.functionName as "fund",
    args: call.args as never,
  });
}

describe("escrow v2.1 calldata", () => {
  test("settle with a lockSig encodes fund(offerHash, cs, lockSig)", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith(writes);
    const { payment, payload } = await signed(rail);
    const lockSig = `0x${"77".repeat(65)}` as Hex;

    expect((await rail.settle(payment, payment.accepted, { lockSig })).success).toBe(true);
    expect(writes).toHaveLength(1);
    const call = writes[0]!;
    expect(call.functionName).toBe("fund");
    expect(call.args).toEqual([...fundArgsV2(payload.terms.offerHash, payload), lockSig]);
    expect(encoded(call)).toBe(
      encodeFunctionData({
        abi: escrowV2Abi,
        functionName: "fund",
        args: [...fundArgsV2(payload.terms.offerHash, payload), lockSig] as never,
      }),
    );
  });

  test("settle without opts encodes an empty lockSig", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith(writes);
    const { payment, payload } = await signed(rail);

    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    expect(writes).toHaveLength(1);
    const call = writes[0]!;
    expect(call.functionName).toBe("fund");
    expect(call.args).toEqual([...fundArgsV2(payload.terms.offerHash, payload), "0x"]);
    expect(encoded(call)).toBe(
      encodeFunctionData({
        abi: escrowV2Abi,
        functionName: "fund",
        args: [...fundArgsV2(payload.terms.offerHash, payload), "0x"] as never,
      }),
    );
  });

  test("dispute encodes (jobId, status, buyerSig)", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith(writes);
    const jobId = `0x${"12".repeat(32)}` as Hex;
    const sig = `0x${"34".repeat(65)}` as Hex;

    expect((await rail.escrow!.dispute!(jobId, 5, sig)).success).toBe(true);
    expect(writes).toHaveLength(1);
    const call = writes[0]!;
    expect(call.functionName).toBe("dispute");
    expect(call.args).toEqual([jobId, 5, sig]);
    expect(encoded(call)).toBe(
      encodeFunctionData({ abi: escrowV2Abi, functionName: "dispute", args: [jobId, 5, sig] }),
    );
  });
});
