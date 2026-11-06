import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createPublicClient, getAddress, http } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { whitechainSepolia } from "../../packages/relay/src/chain.ts";
import { refundOrder } from "../../packages/relay/src/refund-client.ts";
import type { RefundOrderView } from "../../packages/relay/src/refund-client.ts";
import { buy } from "./checkout-customer.ts";
import { checkout } from "./checkout-merchant.ts";

const live = process.env.LIVE_WHITECHAIN === "1";

describe.skipIf(!live)("live Whitechain checkout", () => {
  test(
    "a buyer pays the console's checkout and the merchant refunds it",
    async () => {
      const relayUrl = process.env.RELAY_URL;
      const payTo = process.env.WC_MERCHANT_ADDRESS;
      const buyerKey = process.env.WC_BUYER_PRIVATE_KEY;
      const merchantKey = process.env.WC_MERCHANT_PRIVATE_KEY;
      if (!relayUrl || !payTo || !buyerKey || !merchantKey) {
        throw new Error(
          "LIVE_WHITECHAIN=1 needs RELAY_URL, WC_MERCHANT_ADDRESS, WC_BUYER_PRIVATE_KEY and WC_MERCHANT_PRIVATE_KEY",
        );
      }

      const buyer = privateKeyToAccount(buyerKey as Hex);
      const merchant = privateKeyToAccount(merchantKey as Hex);
      const merchantAddress: Address = getAddress(payTo);
      const shop = new Hono();
      shop.get("/checkout/sticker-pack", checkout(merchantAddress, relayUrl), (c) =>
        c.json({ item: "countersign sticker pack" }),
      );
      const server = Bun.serve({ port: 0, fetch: shop.fetch });

      try {
        const url = `http://127.0.0.1:${server.port}/checkout/sticker-pack`;
        const bought = await buy(buyer, url, merchantAddress);
        expect(bought.item).toEqual({ item: "countersign sticker pack" });
        expect(bought.receipt?.transaction).toBeString();

        const transaction = bought.receipt!.transaction as Hex;
        const chain = createPublicClient({ chain: whitechainSepolia, transport: http() });
        expect(await chain.getChainId()).toBe(1874);
        const paidReceipt = await chain.waitForTransactionReceipt({
          hash: transaction,
          timeout: 60_000,
        });
        expect(paidReceipt.status).toBe("success");

        const orderResponse = await fetch(
          `${relayUrl.replace(/\/+$/, "")}/orders/${encodeURIComponent(transaction)}`,
        );
        expect(orderResponse.ok).toBe(true);
        const order = (await orderResponse.json()) as RefundOrderView;

        const refunded = await refundOrder({
          relayUrl,
          merchant,
          order,
          reason: "requested_by_customer",
        });
        expect(refunded.ok).toBe(true);

        const hash =
          "txHash" in refunded && typeof refunded.txHash === "string"
            ? (refunded.txHash as Hex)
            : "transaction" in refunded && typeof refunded.transaction === "string"
              ? (refunded.transaction as Hex)
              : null;
        expect(hash).not.toBeNull();
        const refundReceipt = await chain.waitForTransactionReceipt({
          hash: hash!,
          timeout: 60_000,
        });
        expect(refundReceipt.status).toBe("success");
      } finally {
        server.stop(true);
      }
    },
    180_000,
  );
});
