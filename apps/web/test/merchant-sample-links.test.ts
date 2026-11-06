/**
 * The merchant desk's sample ledger (?hub=off) links only transactions a chain holds (STEER-2130 A7).
 *
 * Every hash the sample can link is pinned below. Each was read on Whitechain Sepolia (chain 1874)
 * through https://rpc.testnet.whitechain.io on 06 Nov 2026 at 22:33 IST, and each has a receipt with
 * status 1. Every other hash in the sample is a declared stand-in, which the desk shows as plain text.
 * A new linked hash that is neither pinned here nor a stand-in fails this file.
 */

import { describe, expect, test } from "bun:test";
import {
  fixtureCsv,
  fixtureDetail,
  fixtureOrders,
  fixtureRefundTx,
  fixtureStatus,
  isStandIn,
} from "../src/routes/merchant/fixtures.ts";
import { ordersCsv, txUrl, type Order } from "../src/routes/merchant/model.ts";
import { reviewSamples } from "../src/routes/merchant/review-samples.ts";

const VERIFIED_ON_CHAIN = new Set([
  "0x1c366946e8dc6e1256e16880c9345b2cb84613fd5cef920f2214ae840b475f07",
  "0x1e99d1aceab0ddfcebc3f91e6c6650c0c9214f737552382ff68098704cfec5d9",
  "0x3e82355da37166f668d4bc1c428d8b03a262915ef2a856ebb10b1423b89e2447",
  "0x415bddc897b459a2d2342809e1a2621ac3999ca1d5812b3670b563fce504b08c",
  "0x4dc460652c20607ee4a16f699c90f3a0bb94b3ce3696099932cbeb1d95fd42bc",
  "0x565830d7a63f64b7ab3c910b2063345f3d75695d6405d4ffb5495d53e79388e5",
  "0x90ed826a41f21290db924e4afc1e06bffe806e2966d8582618a074efa0c3c812",
]);

/** The sample's accounts, read the same way: the relayer (nonce 20), the merchant and the customer. */
const VERIFIED_ACCOUNTS = new Set([
  "0xa2eefc657138ee5367291f8e2ac45bac28486006",
  "0xd5882dbc7d41fbcf8ae0b05e9eac1cbe93d6c71c",
  "0xcb39cefbf97d1fe8b0606f25721f6f9e32924298",
]);

/** Every transaction field the desk renders for an order: the settlement, the close and each refund. */
function linkable(order: Order): string[] {
  const detail = fixtureDetail(order);
  const hashes = [order.settleTx, order.closeTx, ...order.refundTxs, ...(detail.refunds ?? []).map((r) => r.txHash)];
  return hashes.filter((hash): hash is string => typeof hash === "string" && hash !== "");
}

function hashOf(url: string): string {
  const hash = url.split("/tx/")[1];
  if (!hash) throw new Error(`not a transaction URL: ${url}`);
  return hash.toLowerCase();
}

describe("the sample ledger links only chain-held transactions (STEER-2130 A7)", () => {
  test("every transaction the sample can show is either verified on chain or a declared stand-in", () => {
    const orders = [...fixtureOrders, ...reviewSamples()];
    let real = 0;
    for (const order of orders) {
      for (const hash of linkable(order)) {
        const pinned = VERIFIED_ON_CHAIN.has(hash.toLowerCase());
        expect(pinned || isStandIn(hash)).toBe(true);
        if (pinned) real += 1;
      }
    }
    expect(real).toBeGreaterThan(0);
  });

  test("the sample CSV carries explorer URLs only for verified transactions", () => {
    const csv = fixtureCsv();
    const urls = csv.match(/https?:\/\/[^\s,"]+\/tx\/0x[0-9a-fA-F]{64}/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(VERIFIED_ON_CHAIN.has(hashOf(url))).toBe(true);
    // A stand-in may still appear as data (a direct order's id is its payment hash), never inside a link.
    for (const order of fixtureOrders) {
      for (const hash of linkable(order)) {
        if (isStandIn(hash)) expect(csv.toLowerCase()).not.toContain(`/tx/${hash.toLowerCase()}`);
      }
    }
  });

  test("an order's detail carries explorer URLs only for verified transactions", () => {
    for (const order of fixtureOrders) {
      const detail = fixtureDetail(order);
      const urls = [detail.settleTxUrl, detail.closeTxUrl, ...(detail.refundTxUrls ?? [])].filter(
        (url): url is string => typeof url === "string",
      );
      for (const url of urls) expect(VERIFIED_ON_CHAIN.has(hashOf(url))).toBe(true);
    }
  });

  test("a refund the sample desk simulates is never exported as a link", () => {
    const order = fixtureOrders[0]!;
    const hash = fixtureRefundTx(order.id, 5);
    const csv = ordersCsv([{ ...order, refundTxs: [...order.refundTxs, hash] }], { isStandIn });
    expect(csv.toLowerCase()).not.toContain(`/tx/${hash.toLowerCase()}`);
  });

  test("every account the sample shows is a verified one", () => {
    const accounts = [
      fixtureStatus.address,
      ...[...fixtureOrders, ...reviewSamples()].flatMap((order) => [order.customer, order.merchant]),
    ];
    for (const account of accounts) expect(VERIFIED_ACCOUNTS.has(account.toLowerCase())).toBe(true);
  });

  test("a live export still links every transaction it is given", () => {
    const order = fixtureOrders.find((o) => o.settleTx && isStandIn(o.settleTx));
    if (!order?.settleTx) throw new Error("the sample has no stand-in settlement to test with");
    expect(ordersCsv([order])).toContain(txUrl(order.settleTx));
  });
});
