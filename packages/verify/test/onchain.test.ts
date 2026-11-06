/**
 * The verifier against a real chain: anvil, the real CountersignedEscrow bytecode and an
 * EIP-3009 token. Proves the released event is read and matched against the recomputed
 * body hash, that a self-consistent tampered body fails, and that an unreleased job fails.
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
  type Hex,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  canonicalHash,
  countersignPayload,
  type CountersignExtra,
  type CountersignTerms,
  jobIdOf,
  type Offer,
  offerHash,
  type PaymentPayload,
  slipBodyFor,
  slipCommitHash,
  slipTypedData,
  type Slip,
} from "@countersign/core";
import { escrowAbi } from "../../rail/src/escrow/abi.ts";
import { escrowRail } from "../../rail/src/escrow/index.ts";
import type { Rail } from "../../rail/src/rail.ts";
import { verifySlip } from "../src/verify.ts";

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
const tokenAbi = parseAbi(["function mint(address to, uint256 amount)"]);

let anvil: Subprocess;
let token: Address;
let escrowAddr: Address;
let rail: Rail;
let knownEscrows: Array<{ chainId: number; escrow: Address; name: string }>;

function artifact(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  return json.bytecode.object as Hex;
}

async function deploy(bytecode: Hex, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> {
  const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
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
    hash: await wallet.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "mint",
      args: [buyer.address, 100_000_000n],
    }),
  });
  knownEscrows = [{ chainId: 31337, escrow: escrowAddr, name: "anvil test deployment" }];
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
  title: "verify offer",
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

async function pay(
  salt: string,
): Promise<{ payment: PaymentPayload; jobId: Hex; terms: CountersignTerms }> {
  const req = rail.challenge(offer, { resource: "http://hub/x", now: 0 });
  const extra = req.extra as unknown as CountersignExtra;
  const now = Math.floor(Date.now() / 1000);
  const terms: CountersignTerms = {
    offerHash: extra.offerHash,
    buyer: buyer.address,
    payee: req.payTo as Address,
    amount: req.amount,
    deadline: now + extra.deadlineSeconds,
    salt,
  };
  const input = {
    terms,
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
    jobId: jobIdOf(terms, extra.chainId, extra.escrow),
    terms,
  };
}

async function slipFor(
  payment: PaymentPayload,
  jobId: Hex,
  terms: CountersignTerms,
  transaction: string,
): Promise<Slip> {
  const req = payment.accepted;
  const extra = req.extra as unknown as CountersignExtra;
  const body = slipBodyFor(
    {
      jobId,
      offerHash: extra.offerHash,
      input: { q: "hello" },
      rail: "escrow",
      network: "eip155:31337",
      buyer: buyer.address,
      payTo: req.payTo,
      asset: req.asset,
      amount: req.amount,
      deadline: terms.deadline,
      escrow: extra.escrow,
      chainId: extra.chainId,
      lineage: [],
    },
    seller.address,
    canonicalHash({ q: "hello" }),
    canonicalHash({ a: "world" }),
    Math.floor(Date.now() / 1000),
  );
  return {
    body,
    hash: slipCommitHash(body),
    sellerSig: await seller.signTypedData(slipTypedData(body)),
    payment,
    settlement: { transaction, network: "eip155:31337" },
  };
}

describe("verifySlip on anvil", () => {
  test("a released slip passes the onchain check", async () => {
    const { payment, jobId, terms } = await pay("1001");
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);

    const request = payment.accepted;
    const extra = request.extra as unknown as CountersignExtra;
    const offerHashValue = offerHash(offer);
    expect(extra.offerHash).toBe(offerHashValue);

    const draft = await slipFor(payment, jobId, terms, funded.transaction);
    const released = await rail.escrow!.release(jobId, draft.hash, draft.sellerSig);
    expect(released.success).toBe(true);
    const slip: Slip = { ...draft, settlement: { transaction: released.transaction, network: "eip155:31337" } };

    const verdict = await verifySlip(slip, { rpcUrl, knownEscrows });
    expect(verdict.findings.filter((f) => !f.ok)).toEqual([]);
    expect(verdict.valid).toBe(true);
    const finding = verdict.findings.find((f) => f.check === "onchain");
    expect(finding).toBeDefined();
    expect(finding!.ok).toBe(true);
    expect(finding!.detail).toContain("the chain holds this slip's hash");
    expect(finding!.detail).toContain(`tx ${released.transaction}`);
  }, 30_000);

  test("an unknown escrow is not proof even when the chain holds the hash", async () => {
    const { payment, jobId, terms } = await pay("1004");
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);

    const draft = await slipFor(payment, jobId, terms, funded.transaction);
    const released = await rail.escrow!.release(jobId, draft.hash, draft.sellerSig);
    expect(released.success).toBe(true);
    const slip: Slip = { ...draft, settlement: { transaction: released.transaction, network: "eip155:31337" } };

    const verdict = await verifySlip(slip, { rpcUrl, knownEscrows: [] });
    const escrow = verdict.findings.find((f) => f.check === "escrow");
    expect(escrow).toBeDefined();
    expect(escrow!.ok).toBe(false);
    expect(escrow!.detail).toContain("unknown escrow");
    expect(verdict.findings.find((f) => f.check === "onchain")?.ok).toBe(true);
    expect(verdict.valid).toBe(false);
  }, 30_000);

  test("a tampered body with a recomputed hash fails the onchain check", async () => {
    const { payment, jobId, terms } = await pay("1002");
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);

    const draft = await slipFor(payment, jobId, terms, funded.transaction);
    const released = await rail.escrow!.release(jobId, draft.hash, draft.sellerSig);
    expect(released.success).toBe(true);
    const genuine: Slip = { ...draft, settlement: { transaction: released.transaction, network: "eip155:31337" } };

    const tamperedBody = { ...genuine.body, amount: (BigInt(genuine.body.amount) + 1n).toString(10) };
    const tampered: Slip = { ...genuine, body: tamperedBody, hash: slipCommitHash(tamperedBody) };
    const verdict = await verifySlip(tampered, { rpcUrl, knownEscrows });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain");
    expect(finding).toBeDefined();
    expect(finding!.ok).toBe(false);
    expect(finding!.detail).toContain("differs from the recomputed hash");
  }, 30_000);

  test("a funded job that was never released reports the event missing", async () => {
    const { payment, jobId, terms } = await pay("1003");
    const funded = await rail.settle(payment, payment.accepted);
    expect(funded.success).toBe(true);

    const slip = await slipFor(payment, jobId, terms, funded.transaction);
    const verdict = await verifySlip(slip, { rpcUrl, knownEscrows });
    expect(verdict.valid).toBe(false);
    const finding = verdict.findings.find((f) => f.check === "onchain");
    expect(finding).toBeDefined();
    expect(finding!.ok).toBe(false);
    expect(finding!.detail).toContain("event missing");
  }, 30_000);
});
