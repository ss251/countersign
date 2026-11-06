import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "viem";
import {
  authorizationTypedData,
  canaryMessage,
  delistMessage,
  publishMessage,
  runnerAuthMessage,
  slipTypedData,
  type SlipBody,
} from "@countersign/core";
import {
  checkMessage,
  checkTypedData,
  type SignContext,
} from "../src/cli-auth/policy.ts";
import type { TypedDataInput } from "../src/wallets/privy-wallets.ts";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const ESCROW = "0x10a3c07cc6a519c0106e315d2c42010ecbeff3ce" as Address;
const USDC = "0x3600000000000000000000000000000000000000" as Address;
const CHAIN_ID = 5042002;
const OFFER_HASH = `0x${"ab".repeat(32)}` as Hex;

const ctx: SignContext = {
  address: ADDRESS,
  escrows: [{ chainId: CHAIN_ID, escrow: ESCROW }],
  maxValue: 1_000_000n,
};

function slipBody(overrides: Partial<SlipBody> = {}): SlipBody {
  return {
    v: 1,
    rail: "escrow",
    network: "eip155:5042002",
    offerHash: OFFER_HASH,
    jobId: `0x${"bb".repeat(32)}`,
    buyer: ADDRESS,
    seller: `0x${"22".repeat(20)}`,
    payTo: `0x${"22".repeat(20)}`,
    asset: USDC,
    amount: "10000",
    inputHash: `0x${"cc".repeat(32)}`,
    outputHash: `0x${"dd".repeat(32)}`,
    deliveredAt: 1_700_000_000,
    children: [],
    ...overrides,
  };
}

function releaseTyped(body: SlipBody): TypedDataInput {
  const typed = slipTypedData(body);
  return {
    domain: { ...typed.domain },
    types: { Release: typed.types.Release.map((field) => ({ ...field })) },
    primaryType: typed.primaryType,
    message: { ...typed.message },
  };
}

function buyerTyped(): TypedDataInput {
  const typed = authorizationTypedData({
    terms: {
      offerHash: OFFER_HASH,
      buyer: ADDRESS,
      payee: `0x${"22".repeat(20)}` as Address,
      amount: "10000",
      deadline: 1_800_000_000,
      salt: "1",
    },
    chainId: CHAIN_ID,
    escrow: ESCROW,
    token: USDC,
    tokenName: "USD Coin",
    tokenVersion: "2",
    validAfter: 0,
    validBefore: 1_900_000_000,
  });
  return {
    domain: { ...typed.domain },
    types: {
      ReceiveWithAuthorization: typed.types.ReceiveWithAuthorization.map((field) => ({ ...field })),
    },
    primaryType: typed.primaryType,
    message: { ...typed.message },
  };
}

describe("the CLI signing policy", () => {
  test("the four runner messages sign", () => {
    expect(checkMessage(runnerAuthMessage("ab".repeat(16)))).toEqual({ ok: true });
    expect(checkMessage(publishMessage(OFFER_HASH))).toEqual({ ok: true });
    expect(checkMessage(delistMessage(OFFER_HASH))).toEqual({ ok: true });
    expect(checkMessage(canaryMessage(OFFER_HASH, `0x${"cd".repeat(16)}`))).toEqual({ ok: true });
  });

  test("loose messages are refused", () => {
    const messages = [
      "countersign offer foo",
      "countersign runner 0xabc",
      `countersign canary ${OFFER_HASH}`,
      `countersign offer ${OFFER_HASH} extra`,
      "hello",
      `countersign runner ${"ab".repeat(16)}\nsecond line`,
    ];
    for (const message of messages) {
      expect(checkMessage(message)).toEqual({ ok: false, reason: "message" });
    }
  });

  test("a slip signs on a known escrow and on a rail without one", () => {
    expect(
      checkTypedData(releaseTyped(slipBody({ escrow: ESCROW, chainId: CHAIN_ID })), ctx),
    ).toEqual({ ok: true });

    expect(
      checkTypedData(
        releaseTyped(slipBody({ escrow: `0x${"33".repeat(20)}` as Address, chainId: CHAIN_ID })),
        ctx,
      ),
    ).toEqual({ ok: false, reason: "escrow" });

    expect(checkTypedData(releaseTyped(slipBody()), ctx)).toEqual({ ok: true });
  });

  test("a Release with altered types, an extra domain field or a non-bytes32 value is refused", () => {
    const body = slipBody({ escrow: ESCROW, chainId: CHAIN_ID });

    const alteredTypes = releaseTyped(body);
    const releaseFields = alteredTypes.types.Release!;
    alteredTypes.types.Release = [...releaseFields].reverse();
    expect(checkTypedData(alteredTypes, ctx)).toEqual({ ok: false, reason: "shape" });

    const extraDomain = releaseTyped(body);
    extraDomain.domain = { ...extraDomain.domain, salt: `0x${"00".repeat(32)}` };
    expect(checkTypedData(extraDomain, ctx)).toEqual({ ok: false, reason: "domain" });

    const badValue = releaseTyped(body);
    badValue.message = { ...badValue.message, jobId: "0x1234" };
    expect(checkTypedData(badValue, ctx)).toEqual({ ok: false, reason: "shape" });
  });

  test("a ReceiveWithAuthorization with altered types is refused", () => {
    expect(checkTypedData(buyerTyped(), ctx)).toEqual({ ok: true });

    const reordered = buyerTyped();
    const fields = reordered.types.ReceiveWithAuthorization!;
    reordered.types.ReceiveWithAuthorization = [...fields].reverse();
    expect(checkTypedData(reordered, ctx)).toEqual({ ok: false, reason: "shape" });
  });
});
