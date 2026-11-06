import { describe, expect, test } from "bun:test";
import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { acceptTypedData, disputeTypedData, escrowDomain } from "../src/index.ts";

// Fixed test key. It holds nothing on any chain.
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const CHAIN = 5042002;
const JOB: Hex = `0x${"ab".repeat(32)}`;
const SLIP: Hex = `0x${"cd".repeat(32)}`;

/** The digest the escrow computes: "\x19\x01" ‖ domainSeparator ‖ keccak256(abi.encode(TYPEHASH, ...fields)). */
function solidityDigest(typeString: string, fields: Hex[]): Hex {
  const domainTypeHash = keccak256(
    toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
  );
  const separator = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [domainTypeHash, keccak256(toHex("Countersign")), keccak256(toHex("1")), BigInt(CHAIN), ESCROW],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, ...fields.map(() => ({ type: "bytes32" as const }))],
      [keccak256(toHex(typeString)), ...fields],
    ),
  );
  return keccak256(concat(["0x1901", separator, structHash]));
}

describe("escrow v2 buyer decisions", () => {
  test("Accept hashes as the escrow's Accept(bytes32 jobId,bytes32 slipHash)", () => {
    const td = acceptTypedData(CHAIN, ESCROW, JOB, SLIP);
    expect(td.domain).toEqual(escrowDomain(CHAIN, ESCROW));
    expect(hashTypedData(td)).toBe(solidityDigest("Accept(bytes32 jobId,bytes32 slipHash)", [JOB, SLIP]));
  });

  test("Dispute hashes as the escrow's Dispute(bytes32 jobId)", () => {
    expect(hashTypedData(disputeTypedData(CHAIN, ESCROW, JOB))).toBe(solidityDigest("Dispute(bytes32 jobId)", [JOB]));
  });

  test("a buyer's signature recovers to the buyer, and binds the escrow, chain, job and slip", async () => {
    const td = acceptTypedData(CHAIN, ESCROW, JOB, SLIP);
    const sig = await buyer.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(buyer.address);

    const others = [
      acceptTypedData(CHAIN, "0x5555555555555555555555555555555555555555", JOB, SLIP),
      acceptTypedData(1874, ESCROW, JOB, SLIP),
      acceptTypedData(CHAIN, ESCROW, `0x${"ef".repeat(32)}`, SLIP),
      acceptTypedData(CHAIN, ESCROW, JOB, `0x${"ef".repeat(32)}`),
    ];
    for (const other of others) {
      expect(await recoverTypedDataAddress({ ...other, signature: sig })).not.toBe(buyer.address);
    }
  });

  test("an Accept signature is not a Dispute signature for the same job", async () => {
    const sig = await buyer.signTypedData(acceptTypedData(CHAIN, ESCROW, JOB, SLIP));
    expect(await recoverTypedDataAddress({ ...disputeTypedData(CHAIN, ESCROW, JOB), signature: sig })).not.toBe(
      buyer.address,
    );
  });
});
