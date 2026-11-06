import { afterEach, describe, expect, test } from "bun:test";
import { getAddress, recoverTypedDataAddress } from "viem";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { cancelTypedData } from "@countersign/core";
import { createMerchantApp } from "../src/merchant-server.ts";
import { signCancel } from "../src/merchant.ts";
import { createRelayApp } from "../src/server.ts";
import { WHITECHAIN_ESCROW } from "../src/whitechain-config.ts";
import { NETWORK } from "../src/chain.ts";
import { NOW, createTestRelay, fakeHash, fakeNonce } from "./support.ts";

const servers: { stop: (force?: boolean) => void }[] = [];
afterEach(() => {
  while (servers.length > 0) servers.pop()!.stop(true);
});

const TOKEN = "test-merchant-token-0123456789";

function boot() {
  const relay = createTestRelay();
  const app = createRelayApp({ reader: relay.chain, relayer: relay.relayer, ledger: relay.ledger, now: () => NOW, config: {} });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  servers.push(server);
  const relayUrl = `http://localhost:${server.port}`;
  const merchantApp = createMerchantApp({ merchant: relay.merchant, relayUrl, now: () => NOW, token: TOKEN });
  const auth = { authorization: `Bearer ${TOKEN}` };
  const refund = (id: string, body?: unknown) =>
    merchantApp.request(`/orders/${id}/refund`, {
      method: "POST",
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { relay, relayUrl, merchantApp, refund, auth };
}

function jobFor(payee: string, id: Hex = fakeNonce()) {
  return {
    jobId: id,
    offerHash: fakeNonce(),
    buyer: "0x1111111111111111111111111111111111111111",
    payee,
    amount: 1_500_000n,
    deadline: NOW + 120,
    fundTx: fakeHash(),
    fundBlock: 7n,
    createdAt: NOW * 1000,
  };
}

describe("signCancel", () => {
  test("signs Cancel(jobId) under the escrow domain", async () => {
    const merchant = privateKeyToAccount(generatePrivateKey());
    const jobId = fakeNonce();
    const signature = await signCancel({ merchant, escrow: WHITECHAIN_ESCROW, jobId });
    const signer = await recoverTypedDataAddress({ ...cancelTypedData(1874, WHITECHAIN_ESCROW, jobId), signature });
    expect(signer).toBe(getAddress(merchant.address));
  });
});

describe("merchant one-click refund", () => {
  test("a held escrow order is cancelled through the relay", async () => {
    const { relay, refund } = boot();
    const job = jobFor(relay.merchant.address);
    relay.ledger.recordJob(job);
    const res = await refund(job.jobId);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; status: string };
    expect(out).toMatchObject({ ok: true, status: "cancelled" });
    expect(relay.chain.writes.map((w) => w.functionName)).toEqual(["cancel"]);
    expect(relay.chain.writes[0]!.args![0]).toBe(job.jobId);
    expect(relay.ledger.getJob(job.jobId)!.status).toBe("cancelled");
  });

  test("a paid exact order is refunded with a gasless transfer", async () => {
    const { relay, refund } = boot();
    const id = fakeHash();
    const payer = "0x1111111111111111111111111111111111111111";
    relay.ledger.recordPayment({
      id,
      network: NETWORK,
      payer,
      payTo: relay.merchant.address,
      amount: 2_000_000n,
      nonce: fakeNonce(),
      txHash: id,
      blockNumber: 3n,
      settledAt: NOW * 1000,
    });
    relay.chain.setBalance(relay.merchant.address, 5_000_000n);
    const res = await refund(id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(relay.chain.writes.map((w) => w.functionName)).toEqual(["transferWithAuthorization"]);
    expect(relay.ledger.getOrder(id)!.status).toBe("refunded");
  });

  test("a partial amount refunds part of an order", async () => {
    const { relay, refund } = boot();
    const id = fakeHash();
    relay.ledger.recordPayment({
      id,
      network: NETWORK,
      payer: "0x1111111111111111111111111111111111111111",
      payTo: relay.merchant.address,
      amount: 2_000_000n,
      nonce: fakeNonce(),
      txHash: id,
      blockNumber: 3n,
      settledAt: NOW * 1000,
    });
    const res = await refund(id, { amount: "500000" });
    expect(res.status).toBe(200);
    expect(relay.ledger.getOrder(id)!.status).toBe("partially_refunded");
  });

  test("a cancelled order is not refundable", async () => {
    const { relay, refund } = boot();
    const job = jobFor(relay.merchant.address);
    relay.ledger.recordJob(job);
    relay.ledger.closeJob(job.jobId, "cancelled", fakeHash());
    const res = await refund(job.jobId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "not_refundable" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("another merchant's order is forbidden", async () => {
    const { relay, refund } = boot();
    const job = jobFor(privateKeyToAccount(generatePrivateKey()).address);
    relay.ledger.recordJob(job);
    const res = await refund(job.jobId);
    expect(res.status).toBe(403);
    expect(relay.chain.writes).toHaveLength(0);
    expect(relay.ledger.getJob(job.jobId)!.status).toBe("funded");
  });

  test("an unknown order is 404", async () => {
    const { refund } = boot();
    expect((await refund(fakeNonce())).status).toBe(404);
  });

  test("/orders and /orders.csv proxy the relay for this merchant", async () => {
    const { relay, merchantApp, auth } = boot();
    relay.ledger.recordJob(jobFor(relay.merchant.address));
    relay.ledger.recordJob(jobFor(privateKeyToAccount(generatePrivateKey()).address));
    const list = (await (await merchantApp.request("/orders", { headers: auth })).json()) as { orders: { kind: string }[] };
    expect(list.orders).toHaveLength(1);
    expect(list.orders[0]!.kind).toBe("escrow");
    const csv = await merchantApp.request("/orders.csv", { headers: auth });
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect((await csv.text()).split("\n")[0]).toStartWith("date_utc,order_id,kind");
  });
});

describe("merchant authentication", () => {
  test("a wrong token is 401 and nothing is signed or relayed", async () => {
    const { relay, merchantApp } = boot();
    const res = await merchantApp.request(`/orders/${fakeNonce()}/refund`, {
      method: "POST",
      headers: { authorization: "Bearer wrong-token-wrong-token-wrong" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, reason: "unauthorized" });
    expect(relay.chain.writes).toHaveLength(0);
  });

  test("the right token reaches the relay and refunds", async () => {
    const { relay, merchantApp, auth } = boot();
    const id = fakeHash();
    relay.ledger.recordPayment({
      id,
      network: NETWORK,
      payer: "0x1111111111111111111111111111111111111111",
      payTo: relay.merchant.address,
      amount: 2_000_000n,
      nonce: fakeNonce(),
      txHash: id,
      blockNumber: 3n,
      settledAt: NOW * 1000,
    });
    const res = await merchantApp.request(`/refund/${id}`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(relay.chain.writes.map((w) => w.functionName)).toEqual(["transferWithAuthorization"]);
  });

  test("/me stays public", async () => {
    const { relay, merchantApp } = boot();
    const res = await merchantApp.request("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: relay.merchant.address });
  });

  test("a preflight from a disallowed origin gets no allow-origin header", async () => {
    const { merchantApp } = boot();
    const res = await merchantApp.request("/refund/0x01", {
      method: "OPTIONS",
      headers: {
        origin: "http://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an allowed origin preflight permits the Authorization header", async () => {
    const { merchantApp } = boot();
    const res = await merchantApp.request("/refund/0x01", {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });

  test("/status proxies the relay under the token", async () => {
    const { merchantApp, auth } = boot();
    const res = await merchantApp.request("/status", { headers: auth });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { address: string }).address).toMatch(/^0x/);
  });

  test("a refund is refused when the merchant balance is low", async () => {
    const { relay, refund } = boot();
    const id = fakeHash();
    relay.ledger.recordPayment({
      id,
      network: NETWORK,
      payer: "0x1111111111111111111111111111111111111111",
      payTo: relay.merchant.address,
      amount: 2_000_000n,
      nonce: fakeNonce(),
      txHash: id,
      blockNumber: 3n,
      settledAt: NOW * 1000,
    });
    relay.chain.setBalance(relay.merchant.address, 1n);
    const res = await refund(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: "merchant_balance_low" });
    expect(relay.chain.writes).toHaveLength(0);
  });
});
