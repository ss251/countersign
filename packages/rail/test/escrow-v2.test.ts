/**
 * Escrow v2 on the rail: the 402 carries the offer's bond and review window, the countersignature
 * binds both, and only a v2 config exposes the buyer's decisions. No network: the contract calls
 * are encoded through viem and captured from an injected wallet.
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
  type CountersignPayload,
  type CountersignTerms,
  jobIdOf,
  type Offer,
  type PaymentPayload,
} from "@countersign/core";
import { escrowAbi } from "../src/escrow/abi.ts";
import { escrowV2Abi } from "../src/escrow/abi-v2.ts";
import { DISPUTE_WINDOW_SECONDS, escrowRail, fundArgsV2, offerReviewWindow } from "../src/escrow/index.ts";
import type { Rail } from "../src/rail.ts";

const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SELLER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const buyer = privateKeyToAccount(BUYER_KEY);
const SELLER: Address = privateKeyToAccount(SELLER_KEY).address;
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

interface ReadCall {
  functionName: string;
}

function fakePublic(options: { status?: number; review?: readonly [bigint, bigint, bigint] } = {}): PublicClient<Transport, Chain> {
  return {
    readContract: async (input: { functionName: string }) => {
      switch (input.functionName) {
        case "balanceOf":
          return 10_000_000n;
        case "authorizationState":
          return false;
        case "jobOf":
          return { status: options.status ?? 0 };
        case "reviewOf":
          return options.review ?? [0n, 0n, 0n];
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

function railWith(options: {
  version: 1 | 2;
  writes: WriteCall[];
  read?: Parameters<typeof fakePublic>[0];
}): Rail {
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
    version: options.version,
    now: () => NOW,
    publicClient: fakePublic(options.read),
    walletClient: fakeWallet(options.writes),
  });
}

/** Counter-signature with a real buyer signature (the async helper above cannot await). */
async function signed(rail: Rail, source: Offer, v2: boolean, overrides: Partial<CountersignTerms> = {}) {
  const req = rail.challenge(source, { resource: "http://hub/x", now: NOW });
  const extra = req.extra as unknown as CountersignExtra & {
    bond?: string;
    reviewWindow?: number;
    escrowVersion?: number;
  };
  const terms: CountersignTerms = {
    offerHash: extra.offerHash,
    buyer: buyer.address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: NOW + extra.deadlineSeconds,
    salt: "7",
    ...(v2 ? { bond: extra.bond ?? "0", reviewWindow: extra.reviewWindow ?? 0 } : {}),
    ...overrides,
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
  return { payment, payload, jobId: jobIdOf(terms, extra.chainId, extra.escrow) };
}

const referenceFundAbi = [
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerHash", type: "bytes32" },
      {
        name: "cs",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "salt", type: "uint256" },
          { name: "bond", type: "uint256" },
          { name: "reviewWindow", type: "uint64" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "v", type: "uint8" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
        ],
      },
      { name: "lockSig", type: "bytes" },
    ],
    outputs: [{ name: "jobId", type: "bytes32" }],
  },
] as const;

function encoded(call: WriteCall): Hex {
  return encodeFunctionData({
    abi: call.abi as typeof escrowV2Abi,
    functionName: call.functionName as "fund",
    args: call.args as never,
  });
}

describe("escrow v2 rail", () => {
  test("the 402 carries the offer's bond, review window and version", () => {
    const v2 = railWith({ version: 2, writes: [] });
    const extra = v2.challenge(reviewedOffer, { resource: "x", now: NOW }).extra;
    expect(extra).toMatchObject({ bond: "500000", reviewWindow: 300, escrowVersion: 2 });

    const v1 = railWith({ version: 1, writes: [] });
    const old = v1.challenge(reviewedOffer, { resource: "x", now: NOW }).extra;
    expect(old).toMatchObject({ bond: "500000" });
    expect("escrowVersion" in (old ?? {})).toBe(false);
    expect("reviewWindow" in (old ?? {})).toBe(false);
    expect(offerReviewWindow(reviewedOffer)).toBe(300);
  });

  test("v2 settle encodes fund with the v2 Countersignature in the contract's order", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith({ version: 2, writes });
    const { payment, payload, jobId } = await signed(rail, reviewedOffer, true);

    const result = await rail.settle(payment, payment.accepted);
    expect(result.success).toBe(true);
    expect(writes).toHaveLength(1);
    const call = writes[0]!;
    expect(call.functionName).toBe("fund");
    expect(call.abi).toBe(escrowV2Abi);
    expect(call.args).toEqual([...fundArgsV2(payload.terms.offerHash, payload), "0x"]);

    const reference = encodeFunctionData({
      abi: referenceFundAbi,
      functionName: "fund",
      args: call.args as never,
    });
    expect(encoded(call)).toBe(reference);
    expect(jobId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("the review calls encode through the v2 fragment", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith({ version: 2, writes, read: { review: [300n, 1_000n, 1_300n] } });
    const jobId = `0x${"12".repeat(32)}` as Hex;
    const sig = `0x${"34".repeat(65)}` as Hex;

    expect((await rail.escrow!.accept!(jobId, sig)).success).toBe(true);
    expect((await rail.escrow!.dispute!(jobId, 5, sig)).success).toBe(true);
    expect((await rail.escrow!.releaseAfterWindow!(jobId)).success).toBe(true);
    expect((await rail.escrow!.sweepToll!()).success).toBe(true);
    expect(await rail.escrow!.reviewOf!(jobId)).toEqual({ window: 300, deliveredAt: 1_000, endsAt: 1_300 });

    const names = writes.map((call) => call.functionName);
    expect(names).toEqual(["accept", "dispute", "releaseAfterWindow", "sweepToll"]);
    for (const call of writes) {
      expect(call.abi).toBe(escrowV2Abi);
      expect(encodeFunctionData({ abi: escrowV2Abi, functionName: call.functionName as "accept", args: call.args as never })).toMatch(/^0x[0-9a-f]+$/);
    }
    expect(rail.escrow!.disputeWindowSeconds).toBe(DISPUTE_WINDOW_SECONDS);
  });

  test("status reports delivered and disputed on v2", async () => {
    const delivered = railWith({ version: 2, writes: [], read: { status: 5 } });
    const disputed = railWith({ version: 2, writes: [], read: { status: 6 } });
    expect(await delivered.escrow!.status(`0x${"01".repeat(32)}`)).toBe("delivered");
    expect(await disputed.escrow!.status(`0x${"02".repeat(32)}`)).toBe("disputed");
  });

  test("v1 terms on a v2 rail are refused before any transaction", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith({ version: 2, writes });
    const { payment } = await signed(rail, reviewedOffer, false);

    const check = await rail.verify(payment, payment.accepted);
    expect(check.isValid).toBe(false);
    const failed = await rail.settle(payment, payment.accepted);
    expect(failed.success).toBe(false);
    expect(failed.errorReason).toBe("Refused. The countersigned bond or review window is not the offer's.");
    expect(writes).toHaveLength(0);
  });

  test("a bond or window that is not the offer's is refused before any transaction", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith({ version: 2, writes });
    const movedBond = await signed(rail, reviewedOffer, true, { bond: "1" });
    const movedWindow = await signed(rail, reviewedOffer, true, { reviewWindow: 301 });

    for (const { payment } of [movedBond, movedWindow]) {
      const check = await rail.verify(payment, payment.accepted);
      expect(check.isValid).toBe(false);
      expect(check.invalidReason).toBe("Refused. The countersigned bond or review window is not the offer's.");
      expect((await rail.settle(payment, payment.accepted)).success).toBe(false);
    }
    expect(writes).toHaveLength(0);
  });

  test("a v1 rail has none of the v2 methods and still settles with fund", async () => {
    const writes: WriteCall[] = [];
    const rail = railWith({ version: 1, writes });
    expect(rail.escrow!.accept).toBeUndefined();
    expect(rail.escrow!.dispute).toBeUndefined();
    expect(rail.escrow!.releaseAfterWindow).toBeUndefined();
    expect(rail.escrow!.reviewOf).toBeUndefined();
    expect(rail.escrow!.sweepToll).toBeUndefined();
    expect(rail.escrow!.disputeWindowSeconds).toBe(0);

    const { payment } = await signed(rail, { ...offer, bond: "0" }, false);
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.functionName).toBe("fund");
    expect(writes[0]!.abi).toBe(escrowAbi);
  });
});
