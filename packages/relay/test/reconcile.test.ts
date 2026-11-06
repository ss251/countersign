import { describe, expect, test } from "bun:test";
import { NETWORK } from "../src/chain.ts";
import { reconcilePendingRefunds } from "../src/reconcile.ts";
import { createTestRelay, fakeHash, fakeNonce, NOW } from "./support.ts";

type TestRelay = ReturnType<typeof createTestRelay>;

function paymentId(relay: TestRelay): string {
  const id = fakeHash();
  relay.ledger.recordPayment({
    id,
    network: NETWORK,
    payer: relay.buyer.address,
    payTo: relay.merchant.address,
    amount: 1_000_000n,
    nonce: fakeNonce(),
    txHash: id,
    blockNumber: 10n,
    settledAt: NOW * 1000,
  });
  return id;
}

describe("pending refund reconciliation", () => {
  test("an RPC error keeps the refund pending even after the window", async () => {
    const relay = createTestRelay();
    const id = paymentId(relay);
    relay.ledger.recordPendingRefund(
      { paymentId: id, amount: 1_000_000n, txHash: fakeHash(), nonce: fakeNonce() },
      NOW - 120,
    );
    relay.chain.getTransactionReceipt = async () => {
      const error = new Error("rpc unavailable");
      error.name = "HttpRequestError";
      throw error;
    };

    await reconcilePendingRefunds(id, relay.ctx);

    const refunds = relay.ledger.listRefunds(id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.status).toBe("pending");
    expect(relay.ledger.refundable(id)).toBe(0n);
  });

  test("a used nonce without a receipt confirms the refund with block zero", async () => {
    const relay = createTestRelay();
    const id = paymentId(relay);
    const nonce = fakeNonce();
    relay.ledger.recordPendingRefund(
      { paymentId: id, amount: 1_000_000n, txHash: fakeHash(), nonce },
      NOW + 600,
    );
    relay.chain.useNonce(relay.merchant.address, nonce);

    await reconcilePendingRefunds(id, relay.ctx);

    const refunds = relay.ledger.listRefunds(id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.status).toBe("confirmed");
    expect(refunds[0]!.blockNumber).toBe(0n);
    expect(relay.ledger.refundable(id)).toBe(0n);
  });

  test("an unused nonce past the window deletes the refund", async () => {
    const relay = createTestRelay();
    const id = paymentId(relay);
    relay.ledger.recordPendingRefund(
      { paymentId: id, amount: 1_000_000n, txHash: fakeHash(), nonce: fakeNonce() },
      NOW - 61,
    );

    await reconcilePendingRefunds(id, relay.ctx);

    expect(relay.ledger.listRefunds(id)).toHaveLength(0);
    expect(relay.ledger.refundable(id)).toBe(1_000_000n);
  });
});
