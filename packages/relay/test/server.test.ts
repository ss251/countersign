import { describe, expect, test } from "bun:test";
import { NETWORK, USDT } from "../src/chain.ts";
import { makeCountersignBody } from "./escrow-support.ts";
import { createRelayApp } from "../src/server.ts";
import type { VerifyRequest } from "../src/exact.ts";
import {
  NOW,
  createTestRelay,
  fakeHash,
  fakeNonce,
  makeAuthorization,
  makeRequirements,
  makeVerifyBody,
} from "./support.ts";

type TestRelay = ReturnType<typeof createTestRelay>;

function appFor(relay: TestRelay) {
  return createRelayApp({
    reader: relay.chain,
    relayer: relay.relayer,
    ledger: relay.ledger,
    now: () => NOW,
    config: {},
  });
}

async function bodyFor(relay: TestRelay): Promise<VerifyRequest> {
  const amount = 1_000_000n;
  const requirements = makeRequirements(relay.merchant.address, amount);
  const authorization = makeAuthorization({
    from: relay.buyer.address,
    to: relay.merchant.address,
    value: amount,
  });
  return makeVerifyBody({ signer: relay.buyer, authorization, requirements });
}

describe("relay server", () => {
  test("/supported advertises exact and countersign on chain 1874", async () => {
    const relay = createTestRelay();
    const response = await appFor(relay).request("/supported");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      kinds: unknown[];
      extensions: unknown[];
      signers: Record<string, string[]>;
    };
    expect(body.kinds).toEqual([
      { x402Version: 2, scheme: "exact", network: NETWORK },
      { x402Version: 2, scheme: "countersign", network: NETWORK },
    ]);
    expect(body.extensions).toEqual([]);
    expect(body.signers["eip155:*"]).toEqual([relay.relayer.address]);
  });

  test("/status serialises balances as digit strings", async () => {
    const relay = createTestRelay();
    relay.chain.wbt = 1_500_000_000_000_000_000n;
    const response = await appFor(relay).request("/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      address: string;
      balanceWei: string;
      balanceWbt: string;
      ceiling: { usedWei: string; remainingWei: string; capWei: string };
      policy: { maxFeePerGasWei: string; allowedTokens: string[]; minAmount: string };
      payees: string[];
      minAmount: string;
    };
    expect(body.address).toBe(relay.relayer.address);
    expect(body.balanceWei).toBe("1500000000000000000");
    expect(body.balanceWbt).toBe("1.5");
    expect(body.ceiling.usedWei).toBe("0");
    expect(body.ceiling.capWei).toBe("1000000000000000000");
    expect(body.policy.maxFeePerGasWei).toBe("50000000000");
    expect(body.policy.allowedTokens).toEqual([USDT.address]);
    expect(body.payees).toEqual([relay.merchant.address]);
    expect(body.minAmount).toBe("10000");
  });

  test("/verify accepts a valid payment", async () => {
    const relay = createTestRelay();
    const body = await bodyFor(relay);
    const response = await appFor(relay).request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      isValid: true,
      payer: relay.buyer.address,
    });
  });

  test("malformed JSON on /settle is a 400, not a throw", async () => {
    const relay = createTestRelay();
    const response = await appFor(relay).request("/settle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      errorReason: "invalid_payload",
      transaction: "",
      network: NETWORK,
    });
  });

  test("/payments.csv is an attachment with a CSV content type", async () => {
    const relay = createTestRelay();
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
    const app = appFor(relay);
    const response = await app.request(
      `/payments.csv?payTo=${encodeURIComponent(relay.merchant.address)}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(await response.text()).toStartWith(
      "date_utc,payment_id,payer,merchant,amount_usdt",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("verify and settle dispatch countersign requirements", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const { body, jobId } = await makeCountersignBody(relay);
    const post = (path: string, payload: unknown) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect(((await (await post("/verify", body)).json()) as { isValid: boolean }).isValid).toBe(true);
    const settled = (await (await post("/settle", body)).json()) as { success: boolean; jobId: string };
    expect(settled).toMatchObject({ success: true, jobId });
    const view = (await (await app.request(`/escrow/jobs/${jobId}`)).json()) as { job: { status: string } };
    expect(view.job.status).toBe("funded");
    expect((await app.request(`/escrow/jobs/0x${"12".repeat(32)}`)).status).toBe(404);
  });

  test("escrow routes validate bodies and map outcomes", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const post = (path: string, payload: unknown) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect((await post("/escrow/refund", { jobId: "nope" })).status).toBe(400);
    expect((await post("/escrow/release", { jobId: `0x${"12".repeat(32)}` })).status).toBe(400);
    const zero = await post("/escrow/release", {
      jobId: `0x${"12".repeat(32)}`,
      slipHash: `0x${"00".repeat(32)}`,
      sellerSig: `0x${"ab".repeat(65)}`,
    });
    expect(zero.status).toBe(422);
    expect(await zero.json()).toEqual({ ok: false, reason: "zero_slip_hash" });
    expect((await post("/escrow/refund", { jobId: `0x${"12".repeat(32)}` })).status).toBe(404);
    const { body, jobId } = await makeCountersignBody(relay);
    await post("/settle", body);
    const res = await post("/escrow/refund", { jobId });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "refunded" });
  });

  test("/orders merges payments and jobs; /orders/:id adds urls; /orders.csv is an attachment", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const { body, jobId } = await makeCountersignBody(relay);
    await app.request("/settle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const merchant = relay.merchant.address;
    const list = (await (await app.request(`/orders?merchant=${merchant}`)).json()) as {
      orders: { id: string; status: string; amount: string }[];
    };
    expect(list.orders.map((o) => [o.id, o.status, o.amount])).toEqual([[jobId, "held", "1500000"]]);
    const one = (await (await app.request(`/orders/${jobId}`)).json()) as { settleTxUrl: string; refundTxUrls: string[] };
    expect(one.settleTxUrl).toStartWith("https://explorer.testnet.whitechain.io/tx/");
    expect(one.refundTxUrls).toEqual([]);
    expect((await app.request("/orders/0xnope")).status).toBe(404);
    const csv = await app.request(`/orders.csv?merchant=${merchant}`);
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    expect((await app.request("/orders.csv")).status).toBe(400);
  });

  test("order responses include receivedAt", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
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
    const merchant = encodeURIComponent(relay.merchant.address);
    const list = (await (await app.request(`/orders?merchant=${merchant}`)).json()) as {
      orders: { id: string; receivedAt: number | null }[];
    };
    expect(list.orders).toHaveLength(1);
    expect(list.orders[0]!.id).toBe(id);
    expect(list.orders[0]!.receivedAt).toBe(NOW * 1000);
    const one = (await (await app.request(`/orders/${id}`)).json()) as { receivedAt: number | null };
    expect(one.receivedAt).toBe(NOW * 1000);
  });

  test("list routes refuse without a filter", async () => {
    const app = appFor(createTestRelay());
    for (const path of ["/payments", "/orders", "/payments.csv", "/orders.csv"]) {
      const response = await app.request(path);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "filter_required" });
    }
  });

  test("detail routes stay public", async () => {
    const relay = createTestRelay();
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
    const app = appFor(relay);
    expect((await app.request(`/payments/${id}`)).status).toBe(200);
    expect((await app.request(`/orders/${id}`)).status).toBe(200);
  });

  test("/status names the escrow, token and chain", async () => {
    const body = (await (await appFor(createTestRelay()).request("/status")).json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      escrow: "0x9279D3edeef4c3738a0b200D762e2985Ff3B7eb4",
      token: USDT.address,
      network: NETWORK,
      chainId: 1874,
    });
  });
});
