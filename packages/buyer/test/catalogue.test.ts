import { describe, expect, test } from "bun:test";
import type { PaymentRequirements } from "@countersign/core";
import {
  CIRCLE_CATALOGUE,
  KNOWN_GATEWAYS,
  KNOWN_RAILS,
  hubCallOf,
  parseCatalogue,
  payableVia,
  readCatalogue,
  type CatalogueItem,
} from "../src/index.ts";

const HASH = `0x${"ab".repeat(32)}` as const;
const ARC = KNOWN_RAILS[0]!;
const GATEWAY = KNOWN_GATEWAYS[0]!;

const escrow: PaymentRequirements = {
  scheme: "countersign",
  network: ARC.network,
  amount: "10000",
  asset: ARC.token,
  payTo: "0x0000000000000000000000000000000000000001",
  maxTimeoutSeconds: 600,
  extra: {
    rail: "escrow",
    escrow: ARC.escrow,
    chainId: ARC.chainId,
    offerHash: HASH,
    deadlineSeconds: 600,
    tokenName: ARC.tokenName,
    tokenVersion: ARC.tokenVersion,
  },
};

const gateway: PaymentRequirements = {
  scheme: "exact",
  network: GATEWAY.network,
  amount: "10000",
  asset: GATEWAY.asset,
  payTo: "0x0000000000000000000000000000000000000002",
  maxTimeoutSeconds: 345600,
  extra: { name: GATEWAY.name, version: GATEWAY.version, verifyingContract: GATEWAY.verifyingContract },
};

// A Base mainnet "exact" option, the most common kind in Circle's catalogue.
const base: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "10000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x0000000000000000000000000000000000000003",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};

function item(accepts: PaymentRequirements[], resource = `http://hub.test/offers/${HASH}/call`): CatalogueItem {
  return { resource, type: "http", accepts, metadata: { provider: { name: "countersign" }, method: "POST" } };
}

describe("catalogue", () => {
  test("reads Circle's flat shape and asks the way the Circle CLI does", async () => {
    let asked = "";
    const page = await readCatalogue(CIRCLE_CATALOGUE, { query: "web search", limit: 5 }, async (url) => {
      asked = url;
      return Response.json({ x402Version: 2, items: [item([base])], pagination: { limit: 5, offset: 0, total: 2581 } });
    });
    expect(asked).toBe(`${CIRCLE_CATALOGUE}?query=web+search&limit=5&siwx=false`);
    expect(page.total).toBe(2581);
    expect(page.items).toHaveLength(1);
  });

  test("reads the data-wrapped shape older hubs served", () => {
    const page = parseCatalogue({ data: { x402Version: 2, items: [item([escrow])], pagination: { total: 1 } } });
    expect(page.items[0]?.accepts[0]?.scheme).toBe("countersign");
  });

  test("drops malformed items and refuses a body that is not a catalogue", () => {
    const page = parseCatalogue({
      items: [item([base]), { resource: 7 }, { resource: "x", accepts: [{ scheme: "exact" }] }, null],
    });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(() => parseCatalogue({ results: [] })).toThrow("not an x402 catalogue");
  });

  test("refuses a catalogue that answers an error", async () => {
    const read = readCatalogue("http://catalogue.test", {}, async () => new Response("no", { status: 503 }));
    await expect(read).rejects.toThrow("HTTP 503");
  });

  test("payable only on a pinned escrow or a pinned Gateway", () => {
    expect(payableVia(item([base, escrow]), KNOWN_RAILS)?.kind).toBe("escrow");
    expect(payableVia(item([base, gateway]), KNOWN_RAILS)?.kind).toBe("gateway");
    expect(payableVia(item([base]), KNOWN_RAILS)).toBeUndefined();

    const strangeEscrow = { ...escrow, extra: { ...escrow.extra, escrow: "0x0000000000000000000000000000000000000bad" } };
    expect(payableVia(item([strangeEscrow]), KNOWN_RAILS)).toBeUndefined();
    const strangeGateway = { ...gateway, extra: { ...gateway.extra, verifyingContract: "0x0000000000000000000000000000000000000bad" } };
    expect(payableVia(item([strangeGateway]), KNOWN_RAILS)).toBeUndefined();
  });

  test("splits a hub call URL into hub and offer hash", () => {
    expect(hubCallOf(`https://hub.example/offers/${HASH}/call`)).toEqual({ hub: "https://hub.example", offerHash: HASH });
    expect(hubCallOf(`https://hub.example/base/offers/${HASH}/call/`)?.hub).toBe("https://hub.example/base");
    expect(hubCallOf("https://2captcha.x402.paysponge.com/createTask")).toBeUndefined();
    expect(hubCallOf(`https://hub.example/offers/0x1234/call`)).toBeUndefined();
  });
});
