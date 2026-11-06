import { describe, expect, test } from "bun:test";
import { hashTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizationTypedData,
  checkCountersign,
  countersignPayload,
  COUNTERSIGN_V2_TYPES,
  escrowDomain,
  isV2Terms,
  jobIdOf,
} from "../src/countersign.ts";
import type { CountersignTerms } from "../src/types.ts";

// A fixed anvil test key; never a real one.
const buyer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const TOKEN = "0x3600000000000000000000000000000000000000" as Address;
const CHAIN = 5042002;

const v1: CountersignTerms = {
  offerHash: "0x415362226573a8829b93a895858518b0f691ef38a5c7736b2a0b0be4c6770ae0" as Hex,
  buyer: buyer.address,
  payee: "0xA55a31E3468E03E2Eb094535A8ae8e912e8CB093" as Address,
  amount: "10000",
  deadline: 1_900_000_000,
  salt: "42",
};

describe("escrow v2 countersign terms (D16)", () => {
  test("terms without bond or window are v1, and their jobId is unchanged", () => {
    expect(isV2Terms(v1)).toBe(false);
    const manual = hashTypedData({
      domain: escrowDomain(CHAIN, ESCROW),
      types: {
        Countersign: [
          { name: "offerHash", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "payee", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "salt", type: "uint256" },
        ],
      },
      primaryType: "Countersign",
      message: { offerHash: v1.offerHash, buyer: v1.buyer, payee: v1.payee, amount: 10000n, deadline: 1_900_000_000n, salt: 42n },
    });
    expect(jobIdOf(v1, CHAIN, ESCROW)).toBe(manual);
  });

  test("v2 terms countersign bond and window, so each changes the jobId", () => {
    const v2 = { ...v1, bond: "5000", reviewWindow: 600 };
    expect(isV2Terms(v2)).toBe(true);
    const id = jobIdOf(v2, CHAIN, ESCROW);
    expect(id).toBe(
      hashTypedData({
        domain: escrowDomain(CHAIN, ESCROW),
        types: COUNTERSIGN_V2_TYPES,
        primaryType: "Countersign",
        message: {
          offerHash: v1.offerHash,
          buyer: v1.buyer,
          payee: v1.payee,
          amount: 10000n,
          deadline: 1_900_000_000n,
          salt: 42n,
          bond: 5000n,
          reviewWindow: 600n,
        },
      }),
    );
    expect(jobIdOf({ ...v2, bond: "5001" }, CHAIN, ESCROW)).not.toBe(id);
    expect(jobIdOf({ ...v2, reviewWindow: 601 }, CHAIN, ESCROW)).not.toBe(id);
  });

  test("the v2 jobId matches the vector contracts/test/Parity.t.sol asserts against the contract", () => {
    const terms: CountersignTerms = {
      offerHash: "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex,
      buyer: "0x2222222222222222222222222222222222222222" as Address,
      payee: "0x3333333333333333333333333333333333333333" as Address,
      amount: "1500000",
      deadline: 1_762_400_300,
      salt: "42",
    };
    const at = "0x4444444444444444444444444444444444444444" as Address;
    expect(jobIdOf({ ...terms, bond: "500000", reviewWindow: 3600 }, 5042002, at)).toBe(
      "0x828d7c08e5ceaa062bb376176a187ea3ca6f5b1100b4f7d61c55d4b9dd847790",
    );
    expect(jobIdOf({ ...terms, bond: "0", reviewWindow: 0 }, 5042002, at)).toBe(
      "0x734bac74d246f2670a8a73fd546e8e780aef62c74a7976c6fba258bcabb77f11",
    );
  });

  test("a v2 job with bond 0 and window 0 is still v2: its jobId differs from the v1 one", () => {
    const zero = { ...v1, bond: "0", reviewWindow: 0 };
    expect(isV2Terms(zero)).toBe(true);
    expect(jobIdOf(zero, CHAIN, ESCROW)).not.toBe(jobIdOf(v1, CHAIN, ESCROW));
  });

  test("a v2 payload signs the v2 jobId as the token nonce, and checkCountersign accepts it", async () => {
    const terms = { ...v1, bond: "5000", reviewWindow: 600 };
    const input = {
      terms,
      chainId: CHAIN,
      escrow: ESCROW,
      token: TOKEN,
      tokenName: "USDC",
      tokenVersion: "2",
      validAfter: 0,
      validBefore: 1_900_000_100,
    };
    const td = authorizationTypedData(input);
    expect(td.message.nonce).toBe(jobIdOf(terms, CHAIN, ESCROW));
    const payload = countersignPayload(input, await buyer.signTypedData(td));
    const check = await checkCountersign(payload, {
      chainId: CHAIN,
      escrow: ESCROW,
      token: TOKEN,
      tokenName: "USDC",
      tokenVersion: "2",
      now: 1_800_000_000,
    });
    expect(check.ok).toBe(true);
    // Stripping the bond from the terms makes them v1 terms: another jobId, so the signature no longer fits.
    const stripped = { ...payload, terms: { ...v1 } };
    const refused = await checkCountersign(stripped, {
      chainId: CHAIN,
      escrow: ESCROW,
      token: TOKEN,
      tokenName: "USDC",
      tokenVersion: "2",
      now: 1_800_000_000,
    });
    expect(refused.ok).toBe(false);
  });
});
