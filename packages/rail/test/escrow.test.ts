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
  getAddress,
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
import { escrowRail, fundArgs } from "../src/escrow/index.ts";
import type { Rail } from "../src/rail.ts";

const ROOT = join(import.meta.dir, "../../..");
// anvil's well-known dev keys; they hold nothing anywhere else
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

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
  escrowAddr = await deploy(artifact("CountersignedEscrow.sol", "CountersignedEscrow"), escrowAbi, [
    token,
    "0x000000000000000000000000000000000000dEaD",
    100,
  ]);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [buyer.address, 100_000_000n] }),
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

async function pay(salt: string, priceOverride?: string): Promise<{ payment: PaymentPayload; jobId: Hex }> {
  const req = rail.challenge(offer, { resource: "http://hub/x", now: 0 });
  const extra = req.extra as unknown as CountersignExtra;
  const now = Math.floor(Date.now() / 1000);
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
    const released = await rail.escrow!.release(jobId, slipHash, sellerSig);
    expect(released.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("released");
    const paid = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [seller.address] });
    expect(paid).toBe(1_500_000n - 15_000n);
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
});
