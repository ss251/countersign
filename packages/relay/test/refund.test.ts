import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORK } from "../src/chain.ts";
import { signAuthorization } from "../src/eip3009.ts";
import { refundPayment } from "../src/refund.ts";
import type { RefundResult } from "../src/refund.ts";
import { createTestRelay, fakeHash, fakeNonce, makeAuthorization, NOW } from "./support.ts";

const stranger = privateKeyToAccount(generatePrivateKey());

type TestRelay = ReturnType<typeof createTestRelay>;

function setup(): { relay: TestRelay; paymentId: string } {
  const relay = createTestRelay();
  const paymentId = fakeHash();
  relay.ledger.recordPayment({
    id: paymentId,
    network: NETWORK,
    payer: relay.buyer.address,
    payTo: relay.merchant.address,
    amount: 1_000_000n,
    nonce: fakeNonce(),
    txHash: paymentId,
    blockNumber: 10n,
    settledAt: NOW * 1000,
  });
  return { relay, paymentId };
}

async function refund(
  relay: TestRelay,
  input: {
    paymentId: string;
    signer: ReturnType<typeof privateKeyToAccount>;
    to?: Address;
    value: bigint;
    validBefore?: bigint;
  },
) {
  const authorization = makeAuthorization({
    from: input.signer.address,
    to: input.to ?? relay.buyer.address,
    value: input.value,
    validBefore: input.validBefore,
  });
  return {
    paymentId: input.paymentId,
    authorization,
    signature: await signAuthorization(input.signer, authorization),
  };
}

describe("refundPayment", () => {
  test("refuses an unknown payment id", async () => {
    const { relay } = setup();
    const result = await refundPayment(
      await refund(relay, {
        paymentId: fakeHash(),
        signer: relay.merchant,
        value: 1_000_000n,
      }),
      relay.ctx,
    );
    expect(result).toEqual({ ok: false, reason: "payment_not_found" });
  });

  test("refuses a refund to a stranger", async () => {
    const { relay, paymentId } = setup();
    const result = await refundPayment(
      await refund(relay, {
        paymentId,
        signer: relay.merchant,
        to: stranger.address,
        value: 1_000_000n,
      }),
      relay.ctx,
    );
    expect(result).toEqual({ ok: false, reason: "refund_to_not_payer" });
  });

  test("refuses a refund from someone other than the merchant", async () => {
    const { relay, paymentId } = setup();
    const result = await refundPayment(
      await refund(relay, {
        paymentId,
        signer: relay.buyer,
        value: 1_000_000n,
      }),
      relay.ctx,
    );
    expect(result).toEqual({ ok: false, reason: "refund_from_not_merchant" });
  });

  test("refuses an over-refund", async () => {
    const { relay, paymentId } = setup();
    const result = await refundPayment(
      await refund(relay, {
        paymentId,
        signer: relay.merchant,
        value: 1_000_001n,
      }),
      relay.ctx,
    );
    expect(result).toEqual({ ok: false, reason: "refund_amount" });
  });

  test("allows a partial refund, then the remainder, then nothing", async () => {
    const { relay, paymentId } = setup();

    const partial = await refundPayment(
      await refund(relay, { paymentId, signer: relay.merchant, value: 400_000n }),
      relay.ctx,
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.refunded).toBe(400_000n);
      expect(partial.remaining).toBe(600_000n);
      expect(partial.txUrl).toContain(partial.txHash);
    }

    const rest = await refundPayment(
      await refund(relay, { paymentId, signer: relay.merchant, value: 600_000n }),
      relay.ctx,
    );
    expect(rest.ok).toBe(true);
    if (rest.ok) {
      expect(rest.refunded).toBe(600_000n);
      expect(rest.remaining).toBe(0n);
    }

    const third = await refundPayment(
      await refund(relay, { paymentId, signer: relay.merchant, value: 1n }),
      relay.ctx,
    );
    expect(third).toEqual({ ok: false, reason: "refund_amount" });
  });

  test("two concurrent full refunds yield exactly one success", async () => {
    const { relay, paymentId } = setup();
    relay.chain.writeDelayMs = 5;
    const left = await refund(relay, {
      paymentId,
      signer: relay.merchant,
      value: 1_000_000n,
    });
    const right = await refund(relay, {
      paymentId,
      signer: relay.merchant,
      value: 1_000_000n,
    });
    const results = (await Promise.all([
      refundPayment(left, relay.ctx),
      refundPayment(right, relay.ctx),
    ])) as RefundResult[];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(relay.ledger.refundable(paymentId)).toBe(0n);
    expect(relay.ledger.listRefunds(paymentId)).toHaveLength(1);
  });
});
