/**
 * The merchant's wallet refund, end to end through the relay package's own refundOrder, with a
 * real local key standing in for the browser wallet and a fake relay. Pins what STEER-2225 Fix 3
 * asks of a money path: the cancel is signed for one job on the relayer's own escrow, a direct
 * refund signs exactly the amount for five minutes, and a decline sends nothing.
 */

import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Order } from "../src/routes/merchant/model.ts";
import { sendWalletRefund, type WalletSendInput } from "../src/routes/merchant/wallet-refund.ts";

const wallet = privateKeyToAccount(generatePrivateKey());
const CUSTOMER = "0xcb39cEfBF97d1FE8b0606f25721F6F9E32924298";
const ESCROW = "0x1111111111111111111111111111111111111111";
const JOB = "0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07";
const TX = "0x2222222222222222222222222222222222222222222222222222222222222222";
const RELAY = "https://relay.test";

function order(over: Partial<Order> = {}): Order {
  return {
    id: JOB,
    kind: "escrow",
    customer: CUSTOMER,
    merchant: wallet.address,
    amount: "10000",
    refunded: "0",
    refundable: "10000",
    status: "held",
    createdAt: 1_800_000_000_000,
    settleTx: JOB,
    refundTxs: [],
    ...over,
  };
}

type Seen = { primaryType?: string; domain?: Record<string, unknown>; message?: Record<string, unknown> };

/** A relay that answers every POST with `reply`, and records what reached it. */
function relay(reply: () => Response) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return reply();
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function input(over: Partial<WalletSendInput> & { seen?: Seen }): WalletSendInput {
  const seen = over.seen;
  return {
    order: order(),
    amount: 10_000n,
    relayUrl: RELAY,
    escrow: ESCROW,
    address: wallet.address,
    signTypedData: async (typedData) => {
      if (seen) Object.assign(seen, typedData);
      return wallet.signTypedData(typedData);
    },
    ...over,
  };
}

const rejected = () => Object.assign(new Error("User rejected the request."), { name: "UserRejectedRequestError" });
const ok = () => new Response(JSON.stringify({ ok: true, txHash: TX }), { status: 200 });

describe("a held escrow: the merchant's wallet signs a cancel for this one job", () => {
  test("signed for the relayer's escrow on Whitechain, sent to /escrow/cancel, and the relay's tx comes back", async () => {
    const seen: Seen = {};
    const { calls, fetch } = relay(ok);
    let signedFirst = false;
    const outcome = await sendWalletRefund(input({ seen, fetch, onSigned: () => (signedFirst = calls.length === 0) }));

    expect(outcome).toEqual({ kind: "done", txHash: TX });
    expect(signedFirst).toBe(true);
    expect(seen.primaryType).toBe("Cancel");
    expect(getAddress(String(seen.domain?.verifyingContract))).toBe(getAddress(ESCROW));
    expect(Number(seen.domain?.chainId)).toBe(1874);
    expect(seen.message?.jobId).toBe(JOB);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${RELAY}/escrow/cancel`);
    expect(calls[0]?.body.jobId).toBe(JOB);
  });

  test("declined in the wallet: nothing reaches the relay", async () => {
    const { calls, fetch } = relay(ok);
    const outcome = await sendWalletRefund(input({ fetch, signTypedData: async () => Promise.reject(rejected()) }));
    expect(outcome).toEqual({ kind: "declined" });
    expect(calls).toHaveLength(0);
  });

  test("a part of a held escrow is refused before the wallet opens: a cancel returns all of it", async () => {
    const { calls, fetch } = relay(ok);
    let asked = false;
    const outcome = await sendWalletRefund(
      input({ fetch, amount: 2_500n, signTypedData: async () => ((asked = true), "0x" as Hex) }),
    );
    expect(outcome).toEqual({ kind: "refused", reason: "partial_cancel_not_possible" });
    expect(asked).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("a paid order: the merchant's wallet signs one transfer back to the customer", () => {
  const paid = order({ kind: "exact", status: "paid" });

  test("exactly the amount, to this customer, valid for five minutes", async () => {
    const seen: Seen = {};
    const { calls, fetch } = relay(() => new Response(JSON.stringify({ ok: true, txHash: TX, refunded: "2500" }), { status: 200 }));
    const outcome = await sendWalletRefund(input({ seen, fetch, order: paid, amount: 2_500n }));

    expect(outcome).toEqual({ kind: "done", txHash: TX, refunded: "2500" });
    expect(seen.primaryType).toBe("TransferWithAuthorization");
    expect(getAddress(String(seen.message?.from))).toBe(getAddress(wallet.address));
    expect(getAddress(String(seen.message?.to))).toBe(getAddress(CUSTOMER));
    expect(BigInt(String(seen.message?.value))).toBe(2_500n);
    const validFor = Number(BigInt(String(seen.message?.validBefore))) - Date.now() / 1000;
    expect(validFor).toBeGreaterThan(290);
    expect(validFor).toBeLessThanOrEqual(300);
    expect(calls[0]?.url).toBe(`${RELAY}/refund`);
    expect(calls[0]?.body.paymentId).toBe(JOB);
  });

  test("the transfer is tied to this payment, so a double click cannot refund twice", async () => {
    const first: Seen = {};
    const second: Seen = {};
    const { fetch } = relay(ok);
    await sendWalletRefund(input({ seen: first, fetch, order: paid, amount: 2_500n }));
    await sendWalletRefund(input({ seen: second, fetch, order: paid, amount: 2_500n }));
    // The nonce names the payment and what was refunded before it (wc-10d): the token takes it once.
    const expected = keccak256(
      encodeAbiParameters(parseAbiParameters("string, string, uint256"), ["countersign refund", JOB, 0n]),
    );
    expect(first.message?.nonce).toBe(expected);
    expect(second.message?.nonce).toBe(expected);
  });

  test("declined in the wallet reads as declined, not as the relay client's refund_not_possible", async () => {
    const { calls, fetch } = relay(ok);
    const outcome = await sendWalletRefund(
      input({ fetch, order: paid, amount: 2_500n, signTypedData: async () => Promise.reject(rejected()) }),
    );
    expect(outcome).toEqual({ kind: "declined" });
    expect(calls).toHaveLength(0);
  });

  test("a wallet that fails to sign, without declining, sent nothing either", async () => {
    const { calls, fetch } = relay(ok);
    const outcome = await sendWalletRefund(
      input({ fetch, order: paid, amount: 2_500n, signTypedData: async () => Promise.reject(new Error("device locked")) }),
    );
    expect(outcome).toEqual({ kind: "unsigned" });
    expect(calls).toHaveLength(0);
  });
});

describe("after the wallet signed", () => {
  test("a relay that never answers is unknown, never a failure the merchant could retry blind", async () => {
    const fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof globalThis.fetch;
    expect(await sendWalletRefund(input({ fetch }))).toEqual({ kind: "unknown", reason: "The refund may have been sent." });
  });

  test("the relay's refusal keeps its reason; settlement_pending reads as still settling", async () => {
    const refused = relay(() => new Response(JSON.stringify({ ok: false, reason: "merchant_balance_low" }), { status: 409 }));
    expect(await sendWalletRefund(input({ fetch: refused.fetch }))).toEqual({ kind: "refused", reason: "merchant_balance_low" });

    const pending = relay(() => new Response(JSON.stringify({ ok: false, reason: "settlement_pending" }), { status: 202 }));
    expect(await sendWalletRefund(input({ fetch: pending.fetch }))).toEqual({
      kind: "unknown",
      reason: "The refund was sent and is still settling on chain.",
    });
  });

  test("whichever screen asks, a refund that cannot settle never opens the wallet", async () => {
    const { calls, fetch } = relay(ok);
    let asked = false;
    const never = async () => ((asked = true), "0x" as Hex);

    // A delivered job in its review window: the escrow's cancel needs Funded.
    const inReview = await sendWalletRefund(input({ fetch, order: order({ status: "in_review" }), signTypedData: never }));
    expect(inReview.kind).toBe("refused");

    // A merchant the relayer will not pay gas for.
    const offList = await sendWalletRefund(
      input({
        fetch,
        signTypedData: never,
        status: {
          address: "0xa2EEfc657138eE5367291F8e2Ac45BAC28486006",
          balanceWei: "1",
          balanceWbt: "1",
          ceiling: { capWei: "1", usedWei: "0", remainingWei: "1", txCount: 0, maxTx: 1, resetsAt: 0 },
          network: "eip155:1874",
          chainId: 1874,
          policy: { maxFeePerGasWei: "1", minBalanceWei: "1", allowedPayees: [CUSTOMER] },
        },
      }),
    );
    expect(offList.kind).toBe("refused");

    expect(asked).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("a wallet that is not the order's merchant is refused before it signs", async () => {
    const { calls, fetch } = relay(ok);
    let asked = false;
    const other = privateKeyToAccount(generatePrivateKey());
    const outcome = await sendWalletRefund(
      input({ fetch, address: other.address, signTypedData: async () => ((asked = true), "0x" as Hex) }),
    );
    // Refused by the desk's own check, in words, before the relay client's not_your_order is reached.
    expect(outcome.kind).toBe("refused");
    expect(outcome.kind === "refused" ? outcome.reason : "").toMatch(/is not this order's merchant/);
    expect(asked).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
