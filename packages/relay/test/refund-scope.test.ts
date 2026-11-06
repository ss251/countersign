import { afterEach, describe, expect, test } from "bun:test";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { NETWORK } from "../src/chain.ts";
import { createMerchantApp } from "../src/merchant-server.ts";
import { refundNonce, signRefund } from "../src/merchant.ts";
import { createRelayApp } from "../src/server.ts";
import { NOW, createTestRelay, fakeHash, fakeNonce } from "./support.ts";

const MERCHANT = privateKeyToAccount(generatePrivateKey());
const CUSTOMER = getAddress("0x1111111111111111111111111111111111111111");
const PAYMENT_ID = `0x${"ab".repeat(32)}`;
const OTHER_PAYMENT_ID = `0x${"cd".repeat(32)}`;
const TOKEN = "test-merchant-token-0123456789";

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  while (servers.length > 0) servers.pop()!.stop(true);
});

describe("refundNonce", () => {
  test("is deterministic", () => {
    expect(refundNonce(PAYMENT_ID, 0n)).toBe(refundNonce(PAYMENT_ID, 0n));
  });

  test("changes when the payment id changes", () => {
    expect(refundNonce(PAYMENT_ID, 0n)).not.toBe(refundNonce(OTHER_PAYMENT_ID, 0n));
  });

  test("changes when the amount already refunded changes", () => {
    expect(refundNonce(PAYMENT_ID, 0n)).not.toBe(refundNonce(PAYMENT_ID, 1n));
  });

  test("is a 32-byte hex string", () => {
    expect(refundNonce(PAYMENT_ID, 1_500_000n)).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe("signRefund nonce", () => {
  test("names the payment and the amount already refunded when the payment has an id", async () => {
    const signed = await signRefund({
      merchant: MERCHANT,
      payment: {
        id: PAYMENT_ID,
        payer: CUSTOMER,
        payTo: MERCHANT.address,
        amount: 2_000_000n,
        refunded: 500_000n,
      },
      amount: 500_000n,
      now: NOW,
    });

    expect(signed.authorization.nonce).toBe(refundNonce(PAYMENT_ID, 500_000n));
  });

  test("stays random when the payment has no id", async () => {
    const input = {
      merchant: MERCHANT,
      payment: {
        payer: CUSTOMER,
        payTo: MERCHANT.address,
        amount: 2_000_000n,
        refunded: 0n,
      },
      now: NOW,
    };
    const first = await signRefund(input);
    const second = await signRefund(input);

    expect(first.authorization.nonce).not.toBe(second.authorization.nonce);
  });
});

describe("merchant refund nonces", () => {
  test("POST /orders/:id/refund names the order and its refunded amount", async () => {
    const { relay, refund } = boot();
    const id = fakeHash();
    recordPaid(relay, id);

    const res = await refund(id);
    expect(res.status).toBe(200);
    expect(transferNonce(relay)).toBe(refundNonce(id, 0n));
  });

  test("a later partial refund names the amount already refunded", async () => {
    const { relay, refund } = boot();
    const id = fakeHash();
    recordPaid(relay, id);

    const first = await refund(id, { amount: "500000" });
    expect(first.status).toBe(200);
    const second = await refund(id);
    expect(second.status).toBe(200);

    const writes = relay.chain.writes.filter(
      (write) => write.functionName === "transferWithAuthorization",
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]!.args![5]).toBe(refundNonce(id, 0n));
    expect(writes[1]!.args![5]).toBe(refundNonce(id, 500_000n));
  });

  test("POST /refund/:paymentId names the payment id", async () => {
    const { relay, merchantApp, auth } = boot();
    const id = fakeHash();
    recordPaid(relay, id);

    const res = await merchantApp.request(`/refund/${id}`, {
      method: "POST",
      headers: auth,
    });
    expect(res.status).toBe(200);
    expect(transferNonce(relay)).toBe(refundNonce(id, 0n));
  });
});

function boot() {
  const relay = createTestRelay();
  const app = createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: {},
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  servers.push(server);
  const relayUrl = `http://localhost:${server.port}`;
  const merchantApp = createMerchantApp({
    merchant: relay.merchant,
    relayUrl,
    now: () => NOW,
    token: TOKEN,
  });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const refund = (id: string, body?: unknown) =>
    merchantApp.request(`/orders/${id}/refund`, {
      method: "POST",
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { relay, merchantApp, auth, refund };
}

function recordPaid(relay: ReturnType<typeof createTestRelay>, id: string): void {
  relay.ledger.recordPayment({
    id,
    network: NETWORK,
    payer: CUSTOMER,
    payTo: relay.merchant.address,
    amount: 2_000_000n,
    nonce: fakeNonce(),
    txHash: id,
    blockNumber: 3n,
    settledAt: NOW * 1000,
  });
  relay.chain.setBalance(relay.merchant.address, 5_000_000n);
}

function transferNonce(relay: ReturnType<typeof createTestRelay>): unknown {
  return relay.chain.writes.find(
    (write) => write.functionName === "transferWithAuthorization",
  )?.args?.[5];
}
