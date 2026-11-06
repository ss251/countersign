/**
 * ERC-8004 identity, operator grant, wallet binding and slip-backed feedback on anvil.
 * The mocks live in contracts/test/mocks; nothing here touches a public RPC.
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
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { slipHash, type Slip, type SlipBody } from "@countersign/core";
import {
  agentWalletTypedData,
  bindAgentWallet,
  earnedFeedback,
  feedbackFromSlip,
  giveFeedback,
  grantOperator,
  identityRegistryAbi,
  readFeedback,
  registerAgent,
  registrationFile,
  toDataUri,
} from "../src/index.ts";

const ROOT = join(import.meta.dir, "../../..");
// anvil's well-known dev keys; they hold nothing anywhere else
const deployer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const seller = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const operator = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const buyer = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const newWallet = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
const stranger = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

const port = 20_000 + Math.floor(Math.random() * 20_000);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const deployerWallet = createWalletClient({ chain, transport: http(rpcUrl), account: deployer });
const sellerWallet = createWalletClient({ chain, transport: http(rpcUrl), account: seller });
const operatorWallet = createWalletClient({ chain, transport: http(rpcUrl), account: operator });
const buyerWallet = createWalletClient({ chain, transport: http(rpcUrl), account: buyer });

const HUB = "https://hub.example";
const offerHash: Hex = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let anvil: Subprocess;
let identity: Address;
let reputation: Address;
let agentId: bigint;
let slip: Slip;

function artifact(file: string, name: string): Hex {
  const json = JSON.parse(readFileSync(join(ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  return json.bytecode.object as Hex;
}

async function deploy(bytecode: Hex, abi: readonly unknown[], args: readonly unknown[]): Promise<Address> {
  const hash = await deployerWallet.deployContract({ abi: abi as never, bytecode, args: args as never });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return receipt.contractAddress!;
}

async function latestTimestamp(): Promise<bigint> {
  return (await pub.getBlock()).timestamp;
}

async function agentWalletOf(id: bigint): Promise<Address> {
  return pub.readContract({
    address: identity,
    abi: identityRegistryAbi,
    functionName: "getAgentWallet",
    args: [id],
  });
}

function makeSlip(): Slip {
  const body: SlipBody = {
    v: 1,
    rail: "escrow",
    network: "eip155:31337",
    offerHash,
    jobId: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    buyer: buyer.address,
    seller: seller.address,
    payTo: seller.address,
    asset: "0x3600000000000000000000000000000000000000",
    amount: "1500000",
    inputHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    outputHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    deliveredAt: 1,
    children: [],
    escrow: "0x000000000000000000000000000000000000dEaD",
    chainId: 31337,
  };
  return {
    body,
    hash: slipHash(body),
    sellerSig: `0x${"11".repeat(65)}` as Hex,
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:31337",
        amount: "1500000",
        asset: "0x3600000000000000000000000000000000000000",
        payTo: seller.address,
        maxTimeoutSeconds: 120,
      },
      payload: {},
    },
    settlement: { transaction: `0x${"22".repeat(32)}`, network: "eip155:31337" },
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
  identity = await deploy(artifact("MockIdentityRegistry.sol", "MockIdentityRegistry"), [], []);
  reputation = await deploy(artifact("MockReputationRegistry.sol", "MockReputationRegistry"), [], []);

  const agentURI = toDataUri(
    registrationFile({
      name: "Test seller",
      description: "Sells a test capability.",
      hubUrl: HUB,
      seller: seller.address,
      offers: [offerHash],
    }),
  );
  const registered = await registerAgent(sellerWallet, pub, identity, agentURI);
  agentId = registered.agentId;
  slip = makeSlip();
}, 60_000);

afterAll(() => {
  anvil?.kill();
});

describe("ERC-8004 on anvil", () => {
  test("registering mints the agent and names the seller as owner and wallet", async () => {
    const owner = await pub.readContract({
      address: identity,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [agentId],
    });
    expect(owner).toBe(seller.address);
    expect(await agentWalletOf(agentId)).toBe(seller.address);
  });

  test("the seller grants the hub operator and the operator binds the new wallet", async () => {
    const grant = await grantOperator(sellerWallet, pub, identity, operator.address);
    expect((await pub.waitForTransactionReceipt({ hash: grant })).status).toBe("success");

    const deadline = (await latestTimestamp()) + 240n;
    const bind = await bindAgentWallet({
      wallet: operatorWallet,
      publicClient: pub,
      registry: identity,
      chainId: 31337,
      agentId,
      newWalletAccount: newWallet,
      deadline,
    });
    expect((await pub.waitForTransactionReceipt({ hash: bind })).status).toBe("success");
    expect(await agentWalletOf(agentId)).toBe(newWallet.address);
  });

  test("a signature from the wrong wallet is refused on chain", async () => {
    const deadline = (await latestTimestamp()) + 240n;
    const typed = agentWalletTypedData(identity, 31337, agentId, newWallet.address, seller.address, deadline);
    const signature = await stranger.signTypedData(typed);
    const hash = await operatorWallet.writeContract({
      address: identity,
      abi: identityRegistryAbi,
      functionName: "setAgentWallet",
      args: [agentId, newWallet.address, deadline, signature],
      gas: 200_000n,
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("reverted");
    expect(await agentWalletOf(agentId)).toBe(newWallet.address);
  });

  test("feedback built from a released slip is readable", async () => {
    const feedback = feedbackFromSlip(slip, HUB);
    expect(feedback).toEqual({
      value: 100n,
      valueDecimals: 0,
      tag1: "countersign",
      tag2: "escrow",
      endpoint: `${HUB}/offers/${offerHash}/call`,
      feedbackURI: `${HUB}/slips/${slip.hash}`,
      feedbackHash: slip.hash,
    });

    const tx = await giveFeedback(buyerWallet, pub, reputation, agentId, feedback);
    expect((await pub.waitForTransactionReceipt({ hash: tx })).status).toBe("success");

    const list = await readFeedback(pub, reputation, agentId, 0n);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      client: buyer.address,
      index: 0n,
      value: 100n,
      decimals: 0,
      tag1: "countersign",
      tag2: "escrow",
      endpoint: `${HUB}/offers/${offerHash}/call`,
      feedbackURI: `${HUB}/slips/${slip.hash}`,
      feedbackHash: slip.hash,
      blockNumber: list[0]!.blockNumber,
      tx,
    });
  });

  test("only feedback from the slip's buyer with the slip's hash is earned", async () => {
    const list = await readFeedback(pub, reputation, agentId, 0n);
    const unknown: Hex = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(earnedFeedback(list, [{ hash: slip.hash, buyer: buyer.address }])).toHaveLength(1);
    expect(earnedFeedback(list, [{ hash: slip.hash, buyer: stranger.address }])).toHaveLength(0);
    expect(earnedFeedback(list, [{ hash: unknown, buyer: buyer.address }])).toHaveLength(0);

    const upperBuyer = buyer.address.toUpperCase().replace(/^0X/, "0x") as Address;
    const upperHash = slip.hash.toUpperCase().replace(/^0X/, "0x") as Hex;
    expect(earnedFeedback(list, [{ hash: upperHash, buyer: upperBuyer }])).toHaveLength(1);
  });
});
