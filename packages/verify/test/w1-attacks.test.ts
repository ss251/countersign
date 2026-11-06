import { afterAll, describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  canonicalHash,
  countersignPayload,
  jobIdOf,
  type Slip,
  slipBodyFor,
  slipHash,
  slipTypedData,
} from "@countersign/core";
import { verifySlip } from "../src/verify.ts";

// cs-w1 adversarial tests on the on-chain slip-hash check. A failing test here is a blocker.

const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const seller = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const stranger = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const USDC: Address = "0x3600000000000000000000000000000000000000";
const OFFER = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

async function makeSlip(signer = seller): Promise<Slip> {
  const terms = { offerHash: OFFER, buyer: buyer.address, payee: seller.address, amount: "10000", deadline: 1_762_400_300, salt: "9" };
  const input = { terms, chainId: 5042002, escrow: ESCROW, token: USDC, tokenName: "USDC", tokenVersion: "2", validAfter: 0, validBefore: 1_762_400_600 };
  const payload = countersignPayload(input, await buyer.signTypedData(authorizationTypedData(input)));
  const jobId = jobIdOf(terms, 5042002, ESCROW);
  const body = slipBodyFor(
    { jobId, offerHash: OFFER, input: { q: 1 }, rail: "escrow", network: "eip155:5042002", buyer: buyer.address, payTo: seller.address, asset: USDC, amount: "10000", deadline: terms.deadline, escrow: ESCROW, chainId: 5042002, lineage: [] },
    seller.address,
    canonicalHash({ q: 1 }),
    canonicalHash({ a: 2 }),
    1_762_400_100,
  );
  return {
    body,
    hash: slipHash(body),
    sellerSig: await signer.signTypedData(slipTypedData(body)),
    payment: {
      x402Version: 2,
      accepted: {
        scheme: "countersign",
        network: "eip155:5042002",
        amount: "10000",
        asset: USDC,
        payTo: seller.address,
        maxTimeoutSeconds: 120,
        extra: { rail: "escrow", escrow: ESCROW, chainId: 5042002, offerHash: OFFER, deadlineSeconds: 120, tokenName: "USDC", tokenVersion: "2" },
      },
      payload: payload as unknown as Record<string, unknown>,
    },
    settlement: { transaction: "0xabc", network: "eip155:5042002" },
  };
}


const released = parseAbiItem("event Released(bytes32 indexed jobId, bytes32 indexed slipHash, address indexed payee, uint256 paid, uint256 toll)");
const TX = ("0x" + "ab".repeat(32)) as Hex;

/** A JSON-RPC node that answers for `chainId` and holds one tx whose Released log commits `slipHashOnChain`. */
function fakeNode(chainId: number, slip: Slip, slipHashOnChain: Hex) {
  const topics = encodeEventTopics({ abi: [released], eventName: "Released", args: { jobId: slip.body.jobId, slipHash: slipHashOnChain, payee: seller.address } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [9900n, 100n]);
  const block = "0x" + "cd".repeat(32);
  const receipt = {
    blockHash: block, blockNumber: "0x10", contractAddress: null, cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1",
    from: seller.address, gasUsed: "0x1", logsBloom: "0x" + "00".repeat(256), status: "0x1", to: ESCROW,
    transactionHash: TX, transactionIndex: "0x0", type: "0x2",
    logs: [{ address: ESCROW, topics, data, blockHash: block, blockNumber: "0x10", logIndex: "0x0", transactionHash: TX, transactionIndex: "0x0", removed: false }],
  };
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const { id, method } = (await req.json()) as { id: number; method: string };
      const result = method === "eth_chainId" ? "0x" + chainId.toString(16) : method === "eth_getTransactionReceipt" ? receipt : null;
      return Response.json({ jsonrpc: "2.0", id, result });
    },
  });
}

const servers: ReturnType<typeof Bun.serve>[] = [];
afterAll(() => servers.forEach((s) => s.stop(true)));
function node(chainId: number, slip: Slip, onChain: Hex) {
  const s = fakeNode(chainId, slip, onChain);
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}
async function onchainSlip(): Promise<Slip> {
  const s = await makeSlip();
  s.settlement = { transaction: TX, network: "eip155:5042002" };
  return s;
}
const check = (v: Awaited<ReturnType<typeof verifySlip>>, name: string) => v.findings.find((f) => f.check === name);

describe("W1 slip-hash attacks", () => {
  test("honest slip: the chain holds this slip's hash", async () => {
    const s = await onchainSlip();
    const v = await verifySlip(s, { rpcUrl: node(5042002, s, s.hash) });
    expect(check(v, "onchain")?.ok).toBe(true);
  });

  test("B7: an RPC that answers as another chain cannot vouch for a slip", async () => {
    // The slip names chain 5042002 (Arc) and an escrow address. A node on any other chain (for
    // example 1874, or a private chain that deployed a contract at that address) must not satisfy it.
    const s = await onchainSlip();
    const v = await verifySlip(s, { rpcUrl: node(1874, s, s.hash) });
    expect(check(v, "onchain")?.ok).toBe(false);
    expect(v.valid).toBe(false);
  });

  test("a tampered body whose own hash is self-consistent fails the chain check", async () => {
    const s = await onchainSlip();
    const originalHash = s.hash;
    const forged: Slip = { ...s, body: { ...s.body, amount: "1", outputHash: canonicalHash({ a: "forged" }) } };
    forged.hash = slipHash(forged.body); // the hash check passes
    const v = await verifySlip(forged, { rpcUrl: node(5042002, forged, originalHash) });
    expect(check(v, "hash")?.ok).toBe(true);
    expect(check(v, "onchain")?.ok).toBe(false);
    expect(v.valid).toBe(false);
  });

  test("the committed hash does not move with the settlement receipt", async () => {
    const s = await onchainSlip();
    const other: Slip = { ...s, settlement: { transaction: ("0x" + "ee".repeat(32)) as Hex, network: "eip155:1874", receipt: "anything", url: "http://x" } };
    expect(slipHash(other.body)).toBe(s.hash);
  });

  test("a Released log for another job's slip hash does not vouch for this slip", async () => {
    const s = await onchainSlip();
    const v = await verifySlip(s, { rpcUrl: node(5042002, s, ("0x" + "00".repeat(32)) as Hex) });
    expect(check(v, "onchain")?.ok).toBe(false);
  });
});
