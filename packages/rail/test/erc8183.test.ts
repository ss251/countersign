/**
 * The erc8183 rail against anvil: the real ERC8183Escrow bytecode and an EIP-3009 token.
 * challenge, verify and settle, then complete, where SlipHook emits the slip hash.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Subprocess, spawn, spawnSync } from "bun";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  type Hex,
  http,
  parseAbi,
  parseAbiItem,
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
import { erc8183Abi } from "../src/erc8183/abi.ts";
import { ARC_ERC8183, erc8183Rail } from "../src/erc8183/index.ts";
import type { Rail } from "../src/rail.ts";

const ROOT = join(import.meta.dir, "../../..");
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
const tokenAbi = parseAbi(["function mint(address to, uint256 amount)", "function balanceOf(address) view returns (uint256)"]);
const slipCommitted = parseAbiItem("event SlipCommitted(uint256 indexed acpJobId, bytes32 indexed jobId, bytes32 slipHash)");

let anvil: Subprocess;
let token: Address;
let escrowAddr: Address;
let hook: Address;
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
  escrowAddr = await deploy(artifact("ERC8183Escrow.sol", "ERC8183Escrow"), erc8183Abi, [
    token,
    "0x000000000000000000000000000000000000dEaD",
    100,
    deployer.address,
  ]);
  hook = await pub.readContract({ address: escrowAddr, abi: erc8183Abi, functionName: "hook" });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [buyer.address, 100_000_000n] }),
  });
  rail = erc8183Rail({
    chainId: 31337,
    rpcUrl,
    escrow: escrowAddr,
    hook,
    token,
    tokenName: "USDC",
    tokenVersion: "2",
    symbol: "USDC",
    decimals: 6,
    explorerTx: "http://anvil/tx/{tx}",
    finality: "One block.",
    gasPaidBy: "hub",
    submitter: deployer,
    publicClient: pub,
    walletClient: wallet,
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
  rails: ["erc8183"],
  issuedAt: 1,
};

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

describe("erc8183 declaration", () => {
  const arcEscrow = "0x0000000000000000000000000000000000008183" as Address;
  const arcHook = "0x0000000000000000000000000000000000000818" as Address;
  const arc = erc8183Rail({
    ...ARC_ERC8183,
    rpcUrl: "http://127.0.0.1:1",
    escrow: arcEscrow,
    hook: arcHook,
  });

  test("declares an escrow rail on Arc testnet, beside the countersigned escrow", () => {
    expect(arc.declaration).toEqual({
      id: "erc8183",
      network: "eip155:5042002",
      scheme: "countersign",
      asset: {
        network: "eip155:5042002",
        address: getAddress(ARC_ERC8183.token),
        symbol: "USDC",
        decimals: 6,
      },
      kind: "escrow",
      escrow: getAddress(arcEscrow),
      gasPaidBy: "hub",
      finality: "Final in the Arc block where the job hook commits the slip.",
      explorerTx: "https://explorer.testnet.arc.io/tx/{tx}",
      finalitySeconds: 2,
      cost: { tollBps: 100, fixed: "0" },
    });
    expect(arc.escrow).toBeDefined();
  });

  test("challenge names the job hook, the escrow and the offer", () => {
    const req = arc.challenge(offer, { resource: "http://hub/x", now: 0 });
    expect(req.scheme).toBe("countersign");
    expect(req.network).toBe("eip155:5042002");
    expect(req.amount).toBe("1500000");
    expect(req.asset).toBe(getAddress(ARC_ERC8183.token));
    expect(req.payTo).toBe(seller.address);
    const extra = req.extra as { rail: string; escrow: string; hook: string; offerHash: string; chainId: number };
    expect(extra.rail).toBe("erc8183");
    expect(extra.escrow).toBe(getAddress(arcEscrow));
    expect(extra.hook).toBe(getAddress(arcHook));
    expect(extra.chainId).toBe(5042002);
    expect(extra.offerHash).toBe(offerHash(offer));
  });
});

describe("erc8183 rail on anvil", () => {
  test("verify accepts a countersignature and refuses a moved price and a bad payload", async () => {
    const { payment } = await pay("1");
    const req = payment.accepted;
    expect(await rail.verify(payment, req)).toEqual({ isValid: true, payer: buyer.address });

    const moved = await rail.verify(payment, { ...req, amount: "2000000" });
    expect(moved).toEqual({ isValid: false, invalidReason: "Refused. The price moved after you signed." });

    const garbage = await rail.verify({ ...payment, payload: {} }, req);
    expect(garbage).toEqual({ isValid: false, invalidReason: "Refused. The payment is not a countersignature." });

    const wrongHook = {
      ...req,
      extra: { ...(req.extra as object), hook: "0x0000000000000000000000000000000000000001" },
    };
    const hooked = await rail.verify(payment, wrongHook);
    expect(hooked.isValid).toBe(false);
  });

  test("settle funds the job", async () => {
    const { payment, jobId } = await pay("2");
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);
    expect(funded.payer).toBe(buyer.address);
    expect(await rail.escrow!.status(jobId)).toBe("funded");
    const after = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect(before - after).toBe(1_500_000n);
    const locked = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [escrowAddr] });
    expect(locked).toBe(1_500_000n);

    const again = await rail.verify(payment, payment.accepted);
    expect(again.isValid).toBe(false);
  }, 30_000);

  test("release settles the job and the hook emits the slip hash", async () => {
    const { payment, jobId } = await pay("3");
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);

    const slipHash: Hex = "0x5151515151515151515151515151515151515151515151515151515151515151";
    const sellerSig = await seller.signTypedData(releaseTypedData(31337, escrowAddr, jobId, slipHash));
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [seller.address] });
    const released = await rail.escrow!.release(jobId, slipHash, sellerSig);
    expect(released.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("released");

    const paid = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [seller.address] });
    expect(paid - before).toBe(1_500_000n - 15_000n);

    const receipt = await pub.getTransactionReceipt({ hash: released.transaction as Hex });
    const committed = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== hook.toLowerCase()) return [];
      try {
        const decoded = decodeEventLog({ abi: [slipCommitted], data: log.data, topics: log.topics });
        return decoded.eventName === "SlipCommitted" ? [decoded.args] : [];
      } catch {
        return [];
      }
    });
    expect(committed).toHaveLength(1);
    expect(committed[0]!.jobId).toBe(jobId);
    expect(committed[0]!.slipHash).toBe(slipHash);
  }, 30_000);

  test("a release of the zero hash is refused and sends nothing", async () => {
    const { payment, jobId } = await pay("4");
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    const zeroSig = await seller.signTypedData(releaseTypedData(31337, escrowAddr, jobId, ZERO_HASH));
    const released = await rail.escrow!.release(jobId, ZERO_HASH, zeroSig);
    expect(released.success).toBe(false);
    expect(released.errorReason).toBe("Refused. A release must commit a slip hash.");
    expect(await rail.escrow!.status(jobId)).toBe("funded");
  }, 30_000);

  test("a missed deadline refunds the buyer", async () => {
    const { payment, jobId } = await pay("5");
    const before = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect((await rail.settle(payment, payment.accepted)).success).toBe(true);
    const early = await rail.escrow!.refund(jobId);
    expect(early.success).toBe(false);
    await pub.request({ method: "evm_increaseTime" as never, params: [200] as never });
    await pub.request({ method: "evm_mine" as never, params: [] as never });
    const refunded = await rail.escrow!.refund(jobId);
    expect(refunded.success).toBe(true);
    expect(await rail.escrow!.status(jobId)).toBe("refunded");
    const after = await pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [buyer.address] });
    expect(after).toBe(before);
  }, 30_000);
});
