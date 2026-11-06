import { describe, expect, test } from "bun:test";
import { concat, encodeAbiParameters, hashDomain, hashTypedData, keccak256, toBytes, type Address, type Hex } from "viem";
import { lockTypedData } from "../src/index.ts";

// cs-w1 adversarial test (B27; runs on the fleet branches: cs/32-v21-fleet-abi, cs/33-runner-hub-lock, cs/wc-09b).
// A failing test here is a blocker. #164's post-fix head 83035c8 checks the payee's lock as
// Lock(bytes32 jobId,address funder), with funder = the msg.sender of fund. A lock signed over core's typed
// data must hash to exactly that digest, or every bonded v2 fund reverts LockMissing. The runner signs with
// funder = the address that will submit fund (the hub's submitter on Arc, the relay's key on 1874).
// If you give lockTypedData another shape, adapt the call below and keep the assertion.

const ESCROW: Address = "0x4444444444444444444444444444444444444444";
const FUNDER: Address = "0x5555555555555555555555555555555555555555";
const CHAIN = 5042002;
const JOB: Hex = `0x${"ab".repeat(32)}`;

const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

/** The contract's own digest: _hashTypedDataV4(keccak256(abi.encode(LOCK_TYPEHASH, jobId, msg.sender))). */
function contractLockDigest(jobId: Hex, funder: Address): Hex {
  const separator = hashDomain({
    domain: { name: "Countersign", version: "1", chainId: BigInt(CHAIN), verifyingContract: ESCROW },
    types: DOMAIN_TYPES,
  });
  const typehash = keccak256(toBytes("Lock(bytes32 jobId,address funder)"));
  const structHash = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }], [typehash, jobId, funder]),
  );
  return keccak256(concat(["0x1901", separator, structHash]));
}

describe("W1 B27: the fleet's Lock is the contract's Lock(bytes32 jobId,address funder)", () => {
  test("core's Lock typed data names the funder and hashes to the escrow's digest", () => {
    const build = lockTypedData as unknown as (...args: unknown[]) => Parameters<typeof hashTypedData>[0];
    expect(hashTypedData(build(CHAIN, ESCROW, JOB, FUNDER))).toBe(contractLockDigest(JOB, FUNDER));
  });
});
