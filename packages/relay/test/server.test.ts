import { describe, expect, test } from "bun:test";
import { NETWORK, USDT } from "../src/chain.ts";
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
      policy: { maxFeePerGasWei: string; allowedTokens: string[] };
    };
    expect(body.address).toBe(relay.relayer.address);
    expect(body.balanceWei).toBe("1500000000000000000");
    expect(body.balanceWbt).toBe("1.5");
    expect(body.ceiling.usedWei).toBe("0");
    expect(body.ceiling.capWei).toBe("1000000000000000000");
    expect(body.policy.maxFeePerGasWei).toBe("50000000000");
    expect(body.policy.allowedTokens).toEqual([USDT.address]);
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
});
