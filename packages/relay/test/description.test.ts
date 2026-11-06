import { describe, expect, test } from "bun:test";
import { makeCountersignBody } from "./escrow-support.ts";
import { createRelayApp } from "../src/server.ts";
import type { VerifyRequest } from "../src/exact.ts";
import {
  NOW,
  createTestRelay,
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

async function exactBody(relay: TestRelay): Promise<VerifyRequest> {
  const amount = 1_000_000n;
  const requirements = makeRequirements(relay.merchant.address, amount);
  const authorization = makeAuthorization({
    from: relay.buyer.address,
    to: relay.merchant.address,
    value: amount,
  });
  return makeVerifyBody({ signer: relay.buyer, authorization, requirements });
}

function post(app: ReturnType<typeof appFor>, path: string, payload: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("payment descriptions", () => {
  test("an exact payment keeps the resource description through settle and /orders/:id", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const body = await exactBody(relay);
    body.paymentPayload.resource = {
      url: "https://merchant.example/paid",
      description: "Nightly build minutes",
    };
    const settled = (await (await post(app, "/settle", body)).json()) as {
      success: boolean;
      transaction: string;
    };
    expect(settled.success).toBe(true);
    expect(relay.ledger.getPayment(settled.transaction)?.description).toBe("Nightly build minutes");

    const one = (await (await app.request(`/orders/${settled.transaction}`)).json()) as {
      description: string;
    };
    expect(one.description).toBe("Nightly build minutes");
    const list = (await (
      await app.request(`/orders?merchant=${encodeURIComponent(relay.merchant.address)}`)
    ).json()) as { orders: { description: string }[] };
    expect(list.orders[0]!.description).toBe("Nightly build minutes");
  });

  test("an escrow job keeps the resource description through settle and /orders/:id", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const { body, jobId } = await makeCountersignBody(relay);
    (body.paymentPayload as { resource: { url: string; description?: string } }).resource = {
      url: "http://merchant.example/x",
      description: "Custom settlement review",
    };
    const settled = (await (await post(app, "/settle", body)).json()) as {
      success: boolean;
      jobId: string;
    };
    expect(settled).toMatchObject({ success: true, jobId });
    expect(relay.ledger.getJob(jobId)!.description).toBe("Custom settlement review");

    const one = (await (await app.request(`/orders/${jobId}`)).json()) as {
      description: string;
      resource: string;
    };
    expect(one.description).toBe("Custom settlement review");
    expect(one.resource).toBe("http://merchant.example/x");
  });

  test("the description is capped at 120 characters and a bare URL stores none", async () => {
    const relay = createTestRelay();
    const app = appFor(relay);
    const body = await exactBody(relay);
    const long = "x".repeat(150);
    body.paymentPayload.resource = { url: "https://merchant.example/paid", description: long };
    const settled = (await (await post(app, "/settle", body)).json()) as {
      transaction: string;
    };
    expect(relay.ledger.getPayment(settled.transaction)?.description).toHaveLength(120);

    const plain = await exactBody(relay);
    const plainSettled = (await (await post(app, "/settle", plain)).json()) as {
      transaction: string;
    };
    expect(relay.ledger.getPayment(plainSettled.transaction)?.description).toBeNull();
  });
});
