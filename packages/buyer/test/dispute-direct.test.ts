/**
 * dispute --direct (cs-w1 on #130): when the hub will not relay the buyer's signed dispute,
 * the agent submits dispute(jobId, "") itself, so msg.sender is the buyer.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  custom,
  encodeFunctionData,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { jobIdOf, type CountersignTerms } from "@countersign/core";
import { Journal, State, disputeJob } from "../src/index.ts";
import type { HubClient, KnownRail } from "../src/index.ts";

const BUYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SELLER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const buyer = privateKeyToAccount(BUYER_KEY);
const seller = privateKeyToAccount(SELLER_KEY);

const CHAIN_ID = 31337;
const TOKEN: Address = "0x3600000000000000000000000000000000000000";
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const OFFER: Hex = `0x${"11".repeat(32)}`;
const JOB_ID = jobIdOf(terms(), CHAIN_ID, ESCROW);

function terms(): CountersignTerms {
  return {
    offerHash: OFFER,
    buyer: buyer.address,
    payee: seller.address,
    amount: "1000",
    deadline: 2_000_000_000,
    salt: "7",
  };
}

const RAIL: KnownRail = {
  network: "eip155:31337",
  scheme: "countersign",
  chainId: CHAIN_ID,
  escrow: ESCROW,
  token: TOKEN,
  tokenName: "USDC",
  tokenVersion: "2",
  rpcUrl: "http://127.0.0.1:1",
};

const DISPUTE_ABI = [
  {
    type: "function",
    name: "dispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "bytes32" },
      { name: "buyerSig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function fresh() {
  const state = new State(mkdtempSync(join(tmpdir(), "cs-direct-")));
  const journal = new Journal(state.journalPath);
  const base = {
    at: 1,
    offerHash: OFFER,
    seller: seller.address,
    amount: "1000",
    network: "eip155:31337" as const,
    rail: "escrow" as const,
    jobId: JOB_ID,
  };
  journal.append({ ...base, kind: "countersigned", reservationId: "r1" });
  journal.append({ ...base, kind: "signed", reservationId: "r1", escrow: ESCROW, chainId: CHAIN_ID });
  return { state, journal };
}

const refusingHub = {
  disputeJob: async () => {
    throw new Error("Refused. The hub would not relay it.");
  },
} as unknown as HubClient;

/** A node that signs the dispute locally and hands back a tx hash, recording the raw tx. */
function fakeNode() {
  let raw: Hex | undefined;
  const block = {
    number: "0x1",
    hash: `0x${"00".repeat(32)}`,
    parentHash: `0x${"00".repeat(32)}`,
    nonce: "0x0000000000000000",
    sha3Uncles: `0x${"00".repeat(32)}`,
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: `0x${"00".repeat(32)}`,
    stateRoot: `0x${"00".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    miner: "0x0000000000000000000000000000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: "0x1",
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x3b9aca00",
  };
  const transport = custom({
    async request({ method, params }) {
      switch (method) {
        case "eth_chainId":
          return "0x7a69";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
          return "0x3b9aca00";
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_getBlockByNumber":
          return block;
        case "eth_sendRawTransaction":
          raw = (params as [Hex])[0];
          return `0x${"11".repeat(32)}`;
        default:
          throw new Error(`unexpected RPC method ${method}`);
      }
    },
  });
  return { transport, raw: () => raw };
}

describe("dispute --direct", () => {
  test("sends dispute(jobId, \"\") from the agent's own key when the hub will not relay", async () => {
    const f = fresh();
    const node = fakeNode();
    const done = await disputeJob({
      hub: refusingHub,
      ...f,
      signer: buyer,
      jobId: JOB_ID,
      now: 5,
      known: [RAIL],
      direct: true,
      account: buyer,
      transport: node.transport,
    });

    const raw = node.raw();
    expect(raw).toBeDefined();
    const serialized = raw as TransactionSerialized;
    const tx = parseTransaction(serialized);
    expect(tx.to?.toLowerCase()).toBe(ESCROW.toLowerCase());
    expect(tx.data).toBe(
      encodeFunctionData({ abi: DISPUTE_ABI, functionName: "dispute", args: [JOB_ID, "0x"] }),
    );
    expect((await recoverTransactionAddress({ serializedTransaction: serialized })).toLowerCase()).toBe(
      buyer.address.toLowerCase(),
    );
    expect(done.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(f.journal.entries().at(-1)).toMatchObject({ kind: "disputed", closeTx: done.transaction });
  });

  test("without the flag a hub that will not relay still refuses and sends nothing", async () => {
    const f = fresh();
    const node = fakeNode();
    await expect(
      disputeJob({ hub: refusingHub, ...f, signer: buyer, jobId: JOB_ID, now: 5, known: [RAIL] }),
    ).rejects.toThrow("would not relay");
    expect(node.raw()).toBeUndefined();
    expect(f.journal.entries().some((e) => e.kind === "disputed")).toBe(false);
  });
});
