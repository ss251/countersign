import { describe, expect, test } from "bun:test";
import {
  concat,
  encodeAbiParameters,
  hashDomain,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { disputeTypedData, lockTypedData } from "../src/index.ts";

// A fixed test key. It holds nothing on any chain.
const signer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const CHAIN = 5042002;
const JOB: Hex = `0x${"ab".repeat(32)}`;
const FUNDER: Address = "0x5555555555555555555555555555555555555555";

const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const domain = {
  name: "Countersign",
  version: "1",
  chainId: BigInt(CHAIN),
  verifyingContract: ESCROW,
};
const separator = hashDomain({ domain, types: DOMAIN_TYPES });
const LOCK_TYPEHASH = keccak256(toBytes("Lock(bytes32 jobId,address funder)"));
const DISPUTE_TYPEHASH = keccak256(toBytes("Dispute(bytes32 jobId,uint8 status)"));

function lockDigest(jobId: Hex, funder: Address): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }],
      [LOCK_TYPEHASH, jobId, funder],
    ),
  );
  return keccak256(concat(["0x1901", separator, structHash]));
}

function disputeDigest(jobId: Hex, status: number): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }],
      [DISPUTE_TYPEHASH, jobId, status],
    ),
  );
  return keccak256(concat(["0x1901", separator, structHash]));
}

describe("escrow v2.1 typed data matches the Solidity encoding", () => {
  test("the typehashes are the Solidity type strings", () => {
    expect(LOCK_TYPEHASH).toBe(keccak256(toBytes("Lock(bytes32 jobId,address funder)")));
    expect(DISPUTE_TYPEHASH).toBe(keccak256(toBytes("Dispute(bytes32 jobId,uint8 status)")));
  });

  test("Lock hashes to the escrow's digest and recovers to its signer", async () => {
    const td = lockTypedData(CHAIN, ESCROW, JOB, FUNDER);
    expect(hashTypedData(td)).toBe(lockDigest(JOB, FUNDER));

    const signature = await signer.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(signer.address);
  });

  test("Dispute hashes with Funded (1) and Delivered (5) and recovers to its signer", async () => {
    for (const status of [1, 5]) {
      const td = disputeTypedData(CHAIN, ESCROW, JOB, status);
      expect(hashTypedData(td)).toBe(disputeDigest(JOB, status));

      const signature = await signer.signTypedData(td);
      expect(await recoverTypedDataAddress({ ...td, signature })).toBe(signer.address);
    }
  });
});
