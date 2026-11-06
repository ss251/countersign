/**
 * 10 · Arc Gateway nanopayment. The same skill offer accepts the escrow and Circle Gateway. The
 * buyer pays from its Gateway balance: the balance drops by the price at once, the seller is
 * credited in Gateway's next batch, and the slip names the gateway rail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { canonicalJson, fromBase64Json, PAYMENT_REQUIRED_HEADER, type PaymentRequired, type Slip } from "@countersign/core";
import { buyerCli, readJournal, startHub, startSkillSeller, USE_ARC, verifyCli } from "../lib/actors.ts";
import { units } from "../lib/budget.ts";
import { gatewayAvailable, gatewayWallet } from "../lib/gateway.ts";
import { ARC, sameAddress } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { sleep } from "../lib/http.ts";
import { PRICE } from "./arc-spine.flow.ts";

export const arcGateway: Flow = {
  name: "arc-gateway",
  title: "Arc Gateway nanopayment",
  owner: "orch-cs",
  network: "arc",
  notRun: () => "retired: the Gateway rail was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed",
  spends: (env) => [{ wallet: gatewayWallet(env), amount: PRICE, floor: units("0.10", 6) }],
  async run(ctx) {
    const s = ctx.env.secrets;
    const buyer = s.address("CS_BUYER_ADDRESS");
    const state = join(ctx.dir, "buyer-state");

    const hub = await ctx.step("hub up with the escrow and Gateway rails", async () => {
      const h = await startHub(ctx, { arc: true, env: { GATEWAY_RAIL: "1" } });
      const g = h.rails.find((r) => r.id === "gateway");
      check(g, `the hub declares the gateway rail (rails: ${h.rails.map((r) => r.id).join(", ")})`);
      equal(g.kind, "batched", "gateway rail kind");
      equal(g.network, `eip155:${ARC.chainId}`, "gateway rail network");
      return h;
    });
    const seller = await ctx.step("seller publishes use-arc on both rails", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow", "gateway"], key: "E2E_SELLER_KEY" }),
    );

    await ctx.step("402 offers Circle Gateway", async () => {
      const res = await ctx.http("unpaid call", `${hub.url}/offers/${seller.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 402, "unpaid call status");
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      check(header, "402 carries PAYMENT-REQUIRED");
      const required = fromBase64Json<PaymentRequired>(header);
      equal(canonicalJson(required), canonicalJson(res.json), "header equals body");
      const e = required.accepts.find((a) => a.scheme === "exact" && (a.extra as { name?: string } | undefined)?.name === "GatewayWalletBatched");
      check(e, `the 402 accepts Gateway (it accepts ${required.accepts.map((a) => `${a.scheme}/${(a.extra as { name?: string } | undefined)?.name ?? ""}`).join(", ")})`);
      equal(e.amount, PRICE.toString(), "Gateway amount");
      check(sameAddress(e.payTo, seller.seller), "Gateway pays the seller");
      check(typeof (e.extra as { verifyingContract?: unknown }).verifyingContract === "string", "Gateway names its verifying contract");
      check(required.accepts.some((a) => a.scheme === "countersign"), "the escrow is still offered beside Gateway");
    });

    await ctx.step("envelope approves", async () => {
      const r = await buyerCli(ctx, "envelope", hub.url, state, "CS_BUYER_KEY", [
        "envelope", "set", "--cap", "0.05", "--per-merchant", "0.02", "--allow", seller.seller.toLowerCase(),
      ]);
      equal(r.code, 0, "envelope set exit code");
    });

    const before = await ctx.step("buyer's Gateway balance before", () => gatewayAvailable(s, buyer, (why) => ctx.note(`a Gateway balance read was repeated after a transport failure: ${why}`)));

    const bought = await ctx.step("buyer pays through Gateway", async () => {
      const r = await buyerCli(ctx, "buy", hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", "{}", "--rail", "gateway"]);
      equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 300))})`);
      const slipHash = /^slip (0x[0-9a-f]{64})$/m.exec(r.stdout)?.[1] as Hex | undefined;
      check(slipHash, "buy prints the slip hash");
      const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === seller.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,settled", "journal kinds");
      equal(mine[2]?.rail, "gateway", "journal rail");
      sameHex(mine[2]?.slipHash, slipHash, "journal slip hash");
      return { slipHash, jobId: mine[1]?.jobId as Hex };
    });

    await ctx.step("Gateway debits the buyer at once", async () => {
      let after = before;
      for (let i = 0; i < 10 && before - after < PRICE; i++) {
        after = await gatewayAvailable(s, buyer, (why) => ctx.note(`a Gateway balance read was repeated after a transport failure: ${why}`));
        if (before - after < PRICE) await sleep(1500);
      }
      equal(before - after, PRICE, "Gateway balance drop");
    });

    await ctx.step("slip names the gateway rail and verifies", async () => {
      const slip = JSON.parse(readFileSync(join(state, "slips", `${bought.slipHash}.json`), "utf8")) as Slip;
      const res = await ctx.http("slip", `${hub.url}/slips/${bought.slipHash}`);
      equal(res.status, 200, "slip status code");
      equal(canonicalJson(slip), canonicalJson(res.json), "the buyer's slip equals the hub's");
      equal(slip.body.rail, "gateway", "slip rail");
      equal(slip.body.escrow, undefined, "a Gateway slip names no escrow");
      equal(slip.body.amount, PRICE.toString(), "slip amount");
      check(slip.settlement.transaction.length > 0, "the slip carries the Gateway transfer id");
      ctx.note(`Gateway transfer ${slip.settlement.transaction}; the seller is credited in Gateway's next batch`);
      const job = await ctx.http("job", `${hub.url}/jobs/${bought.jobId}`);
      equal((job.json as { status?: string }).status, "settled", "hub job status");
      const path = ctx.save("slip.json", slip);
      const v = await verifyCli(ctx, "gateway", path, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
    });
  },
};
