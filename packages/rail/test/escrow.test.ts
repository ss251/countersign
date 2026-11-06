/**
 * The escrow rail against a real chain: anvil, the real CountersignedEscrow bytecode and an
 * EIP-3009 token. Proves challenge -> verify -> settle -> release, a moved price refused off
 * chain and reverted on chain, and a permissionless refund after the deadline.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Subprocess, spawn, spawnSync } from "bun";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseSignature,
  toBytes,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  authorizationTypedData,
  countersignPayload,
  jobIdOf,
  type Offer,
  offerHash,
  type PaymentPayload,
  type CountersignExtra,
  releaseTypedData,
  ZERO_HASH,
} from "@countersign/core";
import { escrowAbi } from "../src/escrow/abi.ts";
import { bondOfPayee, escrowRail, fundArgs } from "../src/escrow/index.ts";
import type { Rail } from "../src/rail.ts";

const ROOT = join(import.meta.dir, "../../..");
// anvil's well-known dev keys; they hold nothing anywhere else
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const unbondedSeller = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

const port = 20_000 + Math.floor(Math.random() * 20_000);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: deployer });
const tokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

let anvil: Subprocess;
let token: Address;
let escrowAddr: Address;
let rail: Rail;

function artifact(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  return json.bytecode.object as Hex;
}

async function deploy(bytecode: Hex, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> {
  const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
}

async function blockTime(): Promise<number> {
  return Number((await pub.getBlock()).timestamp);
}

beforeAll(async () => {
  const build = spawnSync(["forge", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(`forge build failed: ${build.stderr.toString()}`);
  anvil = spawn(["anvil", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; ; i++) {
    try {
      await pub.getChainId();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await Bun.sleep(100);
    }
  }
  token = await deploy(artifact("MockEIP3009.sol", "MockEIP3009"), [{ type: "constructor", inputs: [] }], []);
  // The v1 ABI this package speaks, frozen as a fixture until it is ported to escrow v2 (#98).
  escrowAddr = await deploy(artifact("CountersignedEscrowV1.sol", "CountersignedEscrowV1"), escrowAbi, [
    token,
    "0x000000000000000000000000000000000000dEaD",
    100,
    deployer.address,
  ]);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [buyer.address, 100_000_000n] }),
  });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [seller.address, 10_000_000n] }),
  });
  rail = escrowRail({
    id: "escrow",
    chainId: 31337,
    rpcUrl,
    escrow: escrowAddr,
    token,
    tokenName: "USDC",
    tokenVersion: "2",
    symbol: "USDC",
    decimals: 6,
    explorerTx: "http://anvil/tx/{tx}",
    finality: "One block.",
    gasPaidBy: "hub",
    submitter: deployer,
    now: () => Math.floor(Date.now() / 1000),
  });
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "test offer",
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

const receiveTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

async function depositBond(payee: PrivateKeyAccount, amount: bigint): Promise<void> {
  const salt = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}` as Hex;
  const nonce = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [keccak256(toBytes("BondDeposit(address payee,uint256 amount,bytes32 salt)")), payee.address, amount, salt],
    ),
  );
  const now = await blockTime();
  const validAfter = BigInt(Math.max(0, now - 60));
  const validBefore = BigInt(now + 600);
  const signature = await payee.signTypedData({
    domain: { name: "USDC", version: "2", chainId: 31337, verifyingContract: token },
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: payee.address, to: escrowAddr, value: amount, validAfter, validBefore, nonce },
  });
  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : (sig.yParity ?? 0) + 27;
  const hash = await wallet.writeContract({
    address: escrowAddr,
    abi: escrowAbi,
    functionName: "depositBond",
    args: [payee.address, amount, validAfter, validBefore, salt, v, sig.r, sig.s],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("depositBond failed");
}

async function pay(salt: string, offerOverride: Offer = offer, priceOverride?: string): Promise<{ payment: PaymentPayload; jobId: Hex }> {
  const req = rail.challenge(offerOverride, { resource: "http://hub/x", now: 0 });
  const extra = req.extra as unknown as CountersignExtra;
  const now = await blockTime();
  const input = {
    terms: {
      offerHash: extra.offerHash,
      buyer: buyer.address,
      payee: req.payTo as Address,
      amount: priceOverride ?? req.amount,
      deadline: now + extra.deadlineSeconds,
      salt,
    },
    chainId: extra.chainId,
    escrow: extra.escrow,
    token: req.asset as Address,
    tokenName: extra.tokenName,
    tokenVersion: extra.tokenVersion,
    validAfter: 0,
    validBefore: now + 600,
  };
  const signature = await buyer.signTypedData(authorizationTypedData(input));
  const payload = countersignPayload(input, signature);
  return {
    payment: { x402Version: 2, accepted: req, payload: payload as unknown as Record<string, unknown> },
    jobId: jobIdOf(input.terms, extra.chainId, extra.escrow),
  };
}

describe("escrow rail on anvil", () => {
  test("challenge names the escrow, the offer and the token domain", () => {
    const req = rail.challenge(offer, { resource: "http://hub/x", now: 0 });
    expect(req.scheme).toBe("countersign");
    expect(req.network).toBe("eip155:31337");
    expect(req.amount).toBe("1500000");
    expect(req.payTo).toBe(seller.address);
    const extra = req.extra as unknown as CountersignExtra;
    expect(extra.offerHash).toBe(offerHash(offer));
    expect(extra.escrow).toBe(getAddress(escrowAddr));
    expect((req.extra as { bond?: string }).bond).toBe(offer.bond);
  });

  test("verify, settle, release: the seller is paid less the toll", async () => {
    const { payment, jobId } = await pay("1");
    const req = payment.accepted;
    expect(await rail.verify(payment, req)).toEqual({ isValid: true, payer: buyer.address });
    const funded = await rail.settle(payment, req);
    expect(funded.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("funded");

    // the same countersignature cannot be used twice
    const again = await rail.verify(payment, req);
    expect(again.isValid).toBe(false);

    const slipHash: Hex = "0x5151515151515151515151515151515151515151515151515151515151515151";
    const sellerSig = await seller.signTypedData(releaseTypedData(31337, escrowAddr, jobId, slipHash));
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [seller.address] });
    const released = await rail.escrow!.release(jobId, slipHash, sellerSig);
    expect(released.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("released");
    const paid = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [seller.address] });
    expect(paid - before).toBe(1_500_000n - 15_000n);
  }, 30_000);

  test("a release of the zero hash is refused and sends nothing", async () => {
    const { payment, jobId } = await pay("4");
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("funded");

    const zeroSig = await seller.signTypedData(releaseTypedData(31337, escrowAddr, jobId, ZERO_HASH));
    const nonce = await pub.getTransactionCount({ address: deployer.address });
    const released = await rail.escrow!.release(jobId, ZERO_HASH, zeroSig);
    expect(released).toEqual({
      success: false,
      errorReason: "Refused. A release must commit a slip hash.",
      transaction: "",
      network: "eip155:31337",
    });
    expect(await pub.getTransactionCount({ address: deployer.address })).toBe(nonce);
    expect(await rail.escrow!.status(jobId)).toBe("funded");
  }, 30_000);

  test("a moved price is refused off chain and reverted on chain", async () => {
    const { payment } = await pay("2");
    const req = payment.accepted;
    const moved = { ...req, amount: "2000000" };
    const v = await rail.verify(payment, moved);
    expect(v).toEqual({ isValid: false, invalidReason: "Refused. The price moved after you signed." });

    // Force it through anyway: the chain refuses, and the reverted tx is on the record.
    const p = payment.payload as never as Parameters<typeof fundArgs>[1];
    const forged = { ...p, terms: { ...p.terms, amount: "2000000" } };
    const extra = req.extra as unknown as CountersignExtra;
    const hash = await wallet.writeContract({
      address: escrowAddr,
      abi: escrowAbi,
      functionName: "fund",
      args: fundArgs(extra.offerHash, forged),
      gas: 300_000n,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    expect(r.status).toBe("reverted");
  }, 30_000);

  test("a missed deadline refunds to the buyer, whoever calls it", async () => {
    const { payment, jobId } = await pay("3");
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    const early = await rail.escrow!.refund(jobId);
    expect(early.success).toBe(false);
    await pub.request({ method: "evm_increaseTime" as never, params: [200] as never });
    await pub.request({ method: "evm_mine" as never, params: [] as never });
    expect(await blockTime()).toBeGreaterThan(0);
    const refunded = await rail.escrow!.refund(jobId);
    expect(refunded.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("refunded");
    const after = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect(after).toBe(before);
  }, 30_000);

  test("a bonded fund locks the seller's bond on the job", async () => {
    const bonded: Offer = { ...offer, bond: "500000" };
    await depositBond(seller, 500_000n);
    const { payment, jobId } = await pay("5", bonded);
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("funded");

    const jobBond = await pub.readContract({
      address: escrowAddr,
      abi: escrowAbi,
      functionName: "bondOfJob",
      args: [jobId],
    });
    const free = await pub.readContract({
      address: escrowAddr,
      abi: escrowAbi,
      functionName: "bondOf",
      args: [seller.address],
    });
    expect(jobBond).toBe(500_000n);
    expect(free).toBe(0n);
    expect(await bondOfPayee(pub, escrowAddr, seller.address)).toBe("0");
    expect(await rail.escrow!.bondOfPayee!(seller.address)).toBe("0");
  }, 30_000);

  test("failDelivery pays the buyer the amount and the bond", async () => {
    const bonded: Offer = { ...offer, bond: "500000" };
    await depositBond(seller, 500_000n);
    const { payment, jobId } = await pay("6", bonded);
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });

    const failed = await rail.escrow!.failDelivery!(jobId);
    expect(failed.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("failed");

    const after = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect(after - before).toBe(2_000_000n);
  }, 30_000);

  test("a bonded fund with no deposit fails settle with a clear reason", async () => {
    const unbonded: Offer = { ...offer, seller: unbondedSeller.address, bond: "500000" };
    const { payment, jobId } = await pay("7", unbonded);
    const buyerBefore = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [buyer.address],
    });

    const result = await rail.settle(payment, payment.accepted);
    expect(result.success).toBe(false);
    expect(result.errorReason ?? "").toContain("funding");
    expect(result.errorReason ?? "").toContain("fundBonded");
    expect(await rail.escrow!.status(jobId)).toBe("none");
    const buyerAfter = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [buyer.address],
    });
    expect(buyerAfter).toBe(buyerBefore);
  }, 30_000);
});
