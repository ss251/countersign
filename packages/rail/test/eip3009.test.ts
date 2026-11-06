/**
 * The eip3009 rail against a real chain: anvil, the mock USDC token and the rail's
 * relayer. Proves a signed TransferWithAuthorization verifies and settles, that a used
 * nonce cannot be replayed, that every field and balance is checked before any gas is
 * spent, and that a chain-side refusal is a failed settle rather than a throw.
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
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Offer, PaymentPayload, PaymentRequirements } from "@countersign/core";
import {
  eip3009Rail,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  type Eip3009RailConfig,
} from "../src/eip3009/index.ts";
import type { Rail } from "../src/rail.ts";

const ROOT = join(import.meta.dir, "../../..");
// anvil's well-known dev keys; they hold nothing anywhere else
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const thief = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const broke = privateKeyToAccount("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6");

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

const PRICE = "1500000";

let anvil: Subprocess;
let token: Address;

function artifact(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  return json.bytecode.object as Hex;
}

async function deploy(bytecode: Hex, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> {
  const hash = await wallet.deployContract({ abi: abi as never, bytecode, args: args as never });
  const r = await pub.waitForTransactionReceipt({ hash });
  return r.contractAddress!;
}

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function makeRail(overrides: Partial<Eip3009RailConfig> = {}): Rail {
  return eip3009Rail({
    id: "eip3009",
    chainId: 31337,
    rpcUrl,
    token,
    tokenName: "USDC",
    tokenVersion: "2",
    symbol: "USDC",
    decimals: 6,
    explorerTx: "http://anvil/tx/{tx}",
    submitter: deployer,
    now: () => Math.floor(Date.now() / 1000),
    ...overrides,
  });
}

interface AuthOverrides {
  from?: Address;
  signer?: PrivateKeyAccount;
  to?: string;
  value?: string;
  validAfter?: number;
  validBefore?: number;
  nonce?: Hex;
}

async function signPayment(
  req: PaymentRequirements,
  over: AuthOverrides = {},
): Promise<{ payment: PaymentPayload; nonce: Hex; validBefore: number }> {
  const now = Math.floor(Date.now() / 1000);
  const from = over.from ?? buyer.address;
  const signer = over.signer ?? buyer;
  const nonce = over.nonce ?? randomNonce();
  const validAfter = over.validAfter ?? now - 5;
  const validBefore = over.validBefore ?? now + 120;
  const to = getAddress((over.to ?? req.payTo) as Address);
  const value = over.value ?? req.amount;
  const signature = await signer.signTypedData({
    domain: { name: "USDC", version: "2", chainId: 31337, verifyingContract: token },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(from),
      to,
      value: BigInt(value),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    },
  });
  return {
    payment: {
      x402Version: 2,
      accepted: req,
      payload: {
        signature,
        authorization: {
          from: getAddress(from),
          to,
          value,
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce,
        },
      },
    },
    nonce,
    validBefore,
  };
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
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: token,
      abi: tokenAbi,
      functionName: "mint",
      args: [buyer.address, 100_000_000n],
    }),
  });
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

const offer: Offer = {
  v: 1,
  seller: seller.address,
  title: "direct item",
  summary: "",
  adapter: "skill",
  input: { type: "object" },
  output: { type: "object" },
  price: PRICE,
  deadline: 120,
  bond: "0",
  rails: ["eip3009"],
  issuedAt: 1,
};
const context = { resource: "http://hub/x", now: 0 };

describe("eip3009 rail on anvil", () => {
  test("a signed authorization verifies, settles and pays the seller", async () => {
    const rail = makeRail();
    const req = rail.challenge(offer, context);
    expect(rail.declaration).toMatchObject({
      id: "eip3009",
      network: "eip155:31337",
      scheme: "exact",
      kind: "direct",
      gasPaidBy: "hub",
      explorerTx: "http://anvil/tx/{tx}",
      asset: { network: "eip155:31337", address: getAddress(token), symbol: "USDC", decimals: 6 },
    });
    expect(rail.declaration.finality).toContain("before the work is dispatched");
    expect(req.extra).toEqual({ name: "USDC", version: "2" });
    expect(req.payTo).toBe(seller.address);
    expect(req.amount).toBe(PRICE);

    const { payment } = await signPayment(req);
    expect(await rail.verify(payment, req)).toEqual({ isValid: true, payer: buyer.address });

    const buyerBefore = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [buyer.address],
    });
    const sellerBefore = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [seller.address],
    });
    const gasBefore = await pub.getBalance({ address: deployer.address });
    const buyerGasBefore = await pub.getBalance({ address: buyer.address });

    const settled = await rail.settle(payment, req);
    expect(settled.success).toBe(true);
    expect(settled.network).toBe("eip155:31337");
    expect(settled.transaction).toMatch(/^0x[0-9a-f]{64}$/i);

    const receipt = await pub.getTransactionReceipt({ hash: settled.transaction as Hex });
    expect(receipt?.from.toLowerCase()).toBe(deployer.address.toLowerCase());
    expect(await pub.getBalance({ address: buyer.address })).toBe(buyerGasBefore);
    expect(await pub.getBalance({ address: deployer.address })).toBeLessThan(gasBefore);

    const buyerAfter = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [buyer.address],
    });
    const sellerAfter = await pub.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [seller.address],
    });
    expect(buyerBefore - buyerAfter).toBe(BigInt(PRICE));
    expect(sellerAfter - sellerBefore).toBe(BigInt(PRICE));
  }, 30_000);

  test("replaying a settled payload fails verify because the nonce is used", async () => {
    const rail = makeRail();
    const req = rail.challenge(offer, context);
    const { payment } = await signPayment(req);
    expect((await rail.settle(payment, req)).success).toBe(true);

    const again = await rail.verify(payment, req);
    expect(again.isValid).toBe(false);
    expect(again.invalidReason).toContain("already used");
  }, 30_000);

  test("a wrong to, value, window, signer or balance is refused before any transaction", async () => {
    const rail = makeRail();
    const req = rail.challenge(offer, context);
    const now = Math.floor(Date.now() / 1000);
    const before = await pub.getTransactionCount({ address: deployer.address });

    const cases: Array<Promise<{ payment: PaymentPayload }>> = [
      signPayment(req, { to: thief.address }),
      signPayment(req, { value: (BigInt(req.amount) + 1n).toString(10) }),
      signPayment(req, { validBefore: now + 5 }),
      signPayment(req, { validAfter: now + 10 }),
      signPayment(req, { signer: thief }),
      signPayment(req, { from: broke.address, signer: broke }),
    ];

    for (const pending of cases) {
      const { payment } = await pending;
      const result = await rail.verify(payment, req);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBeTruthy();
    }

    expect(await pub.getTransactionCount({ address: deployer.address })).toBe(before);
  }, 30_000);

  test("settle on a transfer that expired on chain returns a failed result", async () => {
    const fixed = Number((await pub.getBlock()).timestamp);
    const rail = makeRail({ now: () => fixed, receiptTimeoutMs: 5_000 });
    const req = rail.challenge(offer, context);
    const { payment } = await signPayment(req, { validAfter: fixed - 5, validBefore: fixed + 6 });
    expect((await rail.verify(payment, req)).isValid).toBe(true);

    await pub.request({
      method: "evm_setNextBlockTimestamp" as never,
      params: [fixed + 10] as never,
    });

    const result = await rail.settle(payment, req);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBeTruthy();
    expect(result.network).toBe("eip155:31337");
  }, 30_000);
});
