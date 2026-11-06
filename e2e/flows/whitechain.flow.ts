/**
 * 5 · Whitechain. A buyer agent with no WBT and no transaction history buys a skill in USDT on
 * chain 1874; the relay pays every fee. Then the merchant refunds it in one click.
 *
 * 7 · Merchant. Another sale, then the merchant's totals, a partial refund and the accountant's
 * export, each matched to what the chain shows.
 *
 * Both run against the suite's own relay, merchant server and hub (lib/whitechain.ts). Until the
 * relay is in this branch both report NOT RUN.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { Slip } from "@countersign/core";
import { buyerCli, readJournal } from "../lib/actors.ts";
import { formatAmount, units, wallets } from "../lib/budget.ts";
import {
  escrowEvents,
  explorerTx,
  gasBalance,
  JOB,
  jobOf,
  reader,
  receipt,
  sameAddress,
  tokenTransfers,
  WHITECHAIN,
} from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx, type Spend } from "../lib/flow.ts";
import { linkStatus } from "../lib/http.ts";
import { ROOT } from "../lib/paths.ts";
import { bearer, merchantOrders, parseCsv, startWhitechainStack, type Order, type WhitechainStack } from "../lib/whitechain.ts";
import type { SlipShare } from "./slip-onchain.flow.ts";

const RELAY = join(ROOT, "packages/relay/src/server.ts");
const MERCHANT = join(ROOT, "packages/relay/src/merchant-server.ts");

function relayMissing(): string | null {
  return existsSync(RELAY) && existsSync(MERCHANT) ? null : "relay not in this branch yet";
}

const SALE = 10_000n; // 0.01 USDT, the relay's minimum
const MERCHANT_SALE = 20_000n; // 0.02 USDT
const PARTIAL = 5_000n; // 0.005 USDT
/** One of the relay's refund reasons; the export must carry it back. */
const REFUND_REASON = "requested_by_customer";

function spends(env: Parameters<NonNullable<Flow["spends"]>>[0], buyerSpend: bigint, merchantSpend: bigint): Spend[] {
  const w = wallets(env.secrets);
  return [
    { wallet: w.wcBuyer(), amount: buyerSpend, floor: units("0.10", 6) },
    // Fund, release and a refund transfer at about 5 gwei.
    { wallet: w.wcRelayer(), amount: units("0.004", 18), floor: units("0.01", 18) },
    { wallet: w.wcMerchant(), amount: merchantSpend, floor: units("0.05", 6) },
  ];
}

interface Sale {
  jobId: Hex;
  slipHash: Hex;
  fundTx: Hex;
  releaseTx: Hex;
  paid: bigint;
  toll: bigint;
  slip: Slip;
}

/** The buyer CLI buys the merchant's skill through the hub; the chain is then read for the facts. */
async function buyThroughHub(ctx: FlowCtx, stack: WhitechainStack, price: bigint, label: string): Promise<Sale> {
  const s = ctx.env.secrets;
  const buyer = s.address("WC_BUYER_ADDRESS");
  const state = join(ctx.dir, `buyer-state-${label}`);

  await ctx.step(`${label} · envelope approves`, async () => {
    const r = await buyerCli(ctx, `${label}-envelope`, stack.hub.url, state, "WC_BUYER_PRIVATE_KEY", [
      "envelope", "set", "--cap", "0.10", "--per-merchant", "0.05", "--allow", stack.seller.seller.toLowerCase(),
    ]);
    equal(r.code, 0, "envelope set exit code");
  });

  const bought = await ctx.step(`${label} · buyer pays in USDT, released`, async () => {
    const r = await buyerCli(ctx, `${label}-buy`, stack.hub.url, state, "WC_BUYER_PRIVATE_KEY", ["buy", stack.seller.offerHash, "--input", "{}"]);
    equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 300))})`);
    check(r.stdout.includes("Released. Slip minted."), "buy prints Released. Slip minted.");
    const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === stack.seller.offerHash.toLowerCase());
    equal(mine.map((e) => e.kind).join(","), "countersigned,signed,released", "journal kinds");
    const released = mine[2];
    check(released?.jobId && released.slipHash, "journal carries the job and slip");
    equal(released.rail, "whitechain", "journal rail");
    const slip = JSON.parse(readFileSync(join(state, "slips", `${released.slipHash}.json`), "utf8")) as Slip;
    return { jobId: released.jobId as Hex, slipHash: released.slipHash as Hex, slip };
  });

  return ctx.step(`${label} · chain agrees, relayer paid every fee`, async () => {
    const res = await ctx.http(`${label} job`, `${stack.hub.url}/jobs/${bought.jobId}`);
    equal(res.status, 200, "job status code");
    const j = res.json as { status: string; settleTx: Hex; closeTx: Hex };
    equal(j.status, "released", "hub job status");
    ctx.tx("whitechain", `${label} fund`, j.settleTx);
    ctx.tx("whitechain", `${label} release`, j.closeTx);

    const fund = await receipt(WHITECHAIN, j.settleTx);
    equal(fund.status, "success", "fund receipt");
    check(sameAddress(fund.from, stack.relay.address), `the relayer sent the fund tx (from ${fund.from})`);
    const f = escrowEvents(WHITECHAIN, fund).funded;
    equal(f.length, 1, "Funded events");
    sameHex(f[0]!.jobId, bought.jobId, "Funded.jobId");
    check(sameAddress(f[0]!.buyer, buyer), "Funded.buyer");
    check(sameAddress(f[0]!.payee, stack.merchant.address), "Funded.payee is the merchant");
    equal(f[0]!.amount, price, "Funded.amount");
    check(tokenTransfers(WHITECHAIN, fund).some((t) => sameAddress(t.from, buyer) && sameAddress(t.to, WHITECHAIN.escrow) && t.value === price), "USDT moves from the buyer to the escrow");

    const rel = await receipt(WHITECHAIN, j.closeTx);
    equal(rel.status, "success", "release receipt");
    check(sameAddress(rel.from, stack.relay.address), `the relayer sent the release tx (from ${rel.from})`);
    const r = escrowEvents(WHITECHAIN, rel).released;
    equal(r.length, 1, "Released events");
    sameHex(r[0]!.slipHash, bought.slipHash, "Released.slipHash");
    equal(r[0]!.paid + r[0]!.toll, price, "paid + toll");
    check(tokenTransfers(WHITECHAIN, rel).some((t) => sameAddress(t.from, WHITECHAIN.escrow) && sameAddress(t.to, stack.merchant.address) && t.value === r[0]!.paid), "USDT moves from the escrow to the merchant");
    equal((await jobOf(WHITECHAIN, bought.jobId)).status, JOB.Released, "jobOf status");
    equal(bought.slip.settlement.url, explorerTx("whitechain", j.closeTx), "slip explorer link");
    equal(await linkStatus(bought.slip.settlement.url ?? ""), 200, `the slip's explorer link opens (${bought.slip.settlement.url})`);
    return { ...bought, fundTx: j.settleTx, releaseTx: j.closeTx, paid: r[0]!.paid, toll: r[0]!.toll };
  });
}

async function noGas(ctx: FlowCtx, buyer: Address, when: string): Promise<void> {
  await ctx.step(`buyer holds no gas ${when}`, async () => {
    equal(await gasBalance(WHITECHAIN, buyer), 0n, "buyer WBT balance");
    equal(await reader(WHITECHAIN).getTransactionCount({ address: buyer }), 0, "transactions the buyer has ever sent");
  });
}

async function refund(ctx: FlowCtx, stack: WhitechainStack, order: Order, amount: bigint | null, label: string, reason?: string) {
  const res = await ctx.http(label, `${stack.merchant.url}/orders/${order.id}/refund`, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(stack.merchant.token) },
    body: amount === null ? "" : JSON.stringify({ amount: amount.toString(), ...(reason ? { reason } : {}) }),
    timeoutMs: 120_000,
  });
  equal(res.status, 200, `${label} status (${res.text.slice(0, 200)})`);
  const body = res.json as { ok?: boolean; txHash?: Hex; txUrl?: string; refunded?: string; remaining?: string; reason?: string };
  equal(body.ok, true, `${label} ok (reason ${body.reason})`);
  check(body.txHash, `${label} returns its transaction`);
  ctx.tx("whitechain", label, body.txHash);
  equal(body.txUrl, explorerTx("whitechain", body.txHash), `${label} explorer link`);
  const rcpt = await receipt(WHITECHAIN, body.txHash);
  equal(rcpt.status, "success", `${label} receipt`);
  check(sameAddress(rcpt.from, stack.relay.address), `the relayer sent the ${label} tx`);
  return { body, rcpt };
}

export const whitechain: Flow = {
  name: "whitechain",
  title: "Whitechain USDT payment with zero gas, one-click refund",
  owner: "cs-wc",
  network: "whitechain",
  notRun: relayMissing,
  spends: (env) => spends(env, SALE, SALE),
  async run(ctx) {
    const buyer = ctx.env.secrets.address("WC_BUYER_ADDRESS");
    const stack = await startWhitechainStack(ctx, SALE);
    await noGas(ctx, buyer, "before paying");
    const sale = await buyThroughHub(ctx, stack, SALE, "sale");
    const path = ctx.save("slip.json", sale.slip);
    ctx.share("whitechain.slip", { slip: sale.slip, path, jobId: sale.jobId } satisfies SlipShare);
    await noGas(ctx, buyer, "after paying");

    const order = await ctx.step("the merchant sees the order", async () => {
      const orders = await merchantOrders(ctx, stack.merchant, "orders");
      const o = orders.find((x) => x.id.toLowerCase() === sale.jobId.toLowerCase());
      check(o, `the merchant's orders include job ${sale.jobId.slice(0, 10)}`);
      equal(o.kind, "escrow", "order kind");
      equal(o.status, "paid", "order status");
      equal(o.amount, SALE.toString(), "order amount");
      check(sameAddress(o.customer, buyer), "order customer");
      sameHex(o.settleTx, sale.fundTx, "order settle tx");
      sameHex(o.closeTx ?? "", sale.releaseTx, "order close tx");
      return o;
    });

    await ctx.step("merchant refunds in one click", async () => {
      const { body, rcpt } = await refund(ctx, stack, order, null, "one-click refund");
      equal(body.refunded, SALE.toString(), "refunded amount");
      equal(body.remaining, "0", "remaining");
      check(
        tokenTransfers(WHITECHAIN, rcpt).some((t) => sameAddress(t.from, stack.merchant.address) && sameAddress(t.to, buyer) && t.value === SALE),
        "the full price moves from the merchant back to the buyer",
      );
      const after = (await merchantOrders(ctx, stack.merchant, "orders after refund")).find((x) => x.id === order.id);
      equal(after?.status, "refunded", "order status after the refund");
    });
    await noGas(ctx, buyer, "after the refund");
  },
};

/** Totals as the merchant view computes them, from the product's own model. */
async function productTotals(orders: Order[]): Promise<{ received: string; refunded: string; fees: string; net: string; netNegative: boolean }> {
  const model = (await import(join(ROOT, "apps/web/src/routes/merchant/model.ts"))) as {
    totals(o: readonly Order[]): { received: string; refunded: string; fees: string; net: string; netNegative: boolean };
  };
  return model.totals(orders);
}

export const merchant: Flow = {
  name: "merchant",
  title: "Merchant totals, partial refund and export",
  owner: "cs-wc",
  network: "whitechain",
  notRun: relayMissing,
  spends: (env) => spends(env, MERCHANT_SALE, PARTIAL),
  async run(ctx) {
    const buyer = ctx.env.secrets.address("WC_BUYER_ADDRESS");
    const stack = await startWhitechainStack(ctx, MERCHANT_SALE);
    const sale = await buyThroughHub(ctx, stack, MERCHANT_SALE, "sale");
    const usdt = (n: bigint) => formatAmount(n, 6);

    const order = await ctx.step("totals match the chain", async () => {
      const orders = await merchantOrders(ctx, stack.merchant, "orders");
      equal(orders.length, 1, "orders on this ledger");
      const o = orders[0]!;
      sameHex(o.id, sale.jobId, "order id");
      equal(o.fee, sale.toll.toString(), "order fee is the toll the escrow took");
      const t = await productTotals(orders);
      equal(t.received, MERCHANT_SALE.toString(), "received");
      equal(t.fees, sale.toll.toString(), "fees");
      equal(t.refunded, "0", "refunded");
      equal(t.net, (MERCHANT_SALE - sale.toll).toString(), "net");
      return o;
    });

    const partial = await ctx.step(`partial refund of ${usdt(PARTIAL)} USDT`, async () => {
      const { body, rcpt } = await refund(ctx, stack, order, PARTIAL, "partial refund", REFUND_REASON);
      equal(body.refunded, PARTIAL.toString(), "refunded so far");
      equal(body.remaining, (MERCHANT_SALE - PARTIAL).toString(), "remaining");
      check(
        tokenTransfers(WHITECHAIN, rcpt).some((t) => sameAddress(t.from, stack.merchant.address) && sameAddress(t.to, buyer) && t.value === PARTIAL),
        "exactly the partial amount moves back to the buyer",
      );
      return body.txHash as Hex;
    });

    await ctx.step("totals move by the refund and nothing else", async () => {
      const orders = await merchantOrders(ctx, stack.merchant, "orders after refund");
      const o = orders[0]!;
      equal(o.status, "partially_refunded", "order status");
      equal(o.refunded, PARTIAL.toString(), "order refunded");
      equal(o.refundable, (MERCHANT_SALE - PARTIAL).toString(), "order refundable");
      const t = await productTotals(orders);
      equal(t.received, MERCHANT_SALE.toString(), "received");
      equal(t.refunded, PARTIAL.toString(), "refunded");
      equal(t.net, (MERCHANT_SALE - sale.toll - PARTIAL).toString(), "net");
    });

    await ctx.step("the accountant's export", async () => {
      const res = await ctx.http("orders.csv", `${stack.merchant.url}/orders.csv`, { headers: bearer(stack.merchant.token) });
      equal(res.status, 200, "export status");
      ctx.save("orders.csv", res.text);
      const rows = parseCsv(res.text);
      equal(
        (rows[0] ?? []).join(","),
        "date_utc,order_id,kind,customer,merchant,amount_usdt,fee_usdt,refunded_usdt,net_usdt,status,settle_tx_url,close_tx_url,refund_tx_urls,refund_reasons",
        "export header",
      );
      equal(rows.length, 2, "export rows (header plus one order)");
      const row = Object.fromEntries((rows[0] ?? []).map((k, i) => [k, rows[1]?.[i] ?? ""]));
      sameHex(row.order_id ?? "", sale.jobId, "export order id");
      equal(row.kind, "escrow", "export kind");
      equal(units(row.amount_usdt ?? "0", 6), MERCHANT_SALE, "export amount");
      equal(units(row.fee_usdt ?? "0", 6), sale.toll, "export fee");
      equal(units(row.refunded_usdt ?? "0", 6), PARTIAL, "export refunded");
      equal(units(row.net_usdt ?? "0", 6), MERCHANT_SALE - sale.toll - PARTIAL, "export net");
      equal(row.status, "partially_refunded", "export status");
      equal(row.settle_tx_url, explorerTx("whitechain", sale.fundTx), "export settle link");
      equal(row.close_tx_url, explorerTx("whitechain", sale.releaseTx), "export close link");
      check((row.refund_tx_urls ?? "").includes(explorerTx("whitechain", partial)), "export lists the refund link");
      check((row.refund_reasons ?? "").includes(REFUND_REASON), `export lists the refund's reason (got "${row.refund_reasons}")`);
    });

    await ctx.step("no token, no refund", async () => {
      for (const [label, headers] of [
        ["refund without a token", {}],
        ["refund with a wrong token", bearer("x".repeat(stack.merchant.token.length))],
      ] as const) {
        const res = await ctx.http(label, `${stack.merchant.url}/orders/${order.id}/refund`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ amount: "1" }),
        });
        equal(res.status, 401, `${label} status`);
      }
      const o = (await merchantOrders(ctx, stack.merchant, "orders after refused refunds"))[0];
      equal(o?.refunded, PARTIAL.toString(), "nothing more was refunded");
    });
  },
};
