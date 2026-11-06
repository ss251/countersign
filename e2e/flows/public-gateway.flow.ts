/**
 * 16 · A Gateway nanopayment through the public hub. The buyer CLI here pays a live production
 * offer from its Circle Gateway balance; the balance drops by the price at once, the hosted hub
 * serves the same slip, and the slip verifies.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { canonicalHash, canonicalJson, type Offer, type Slip } from "@countersign/core";
import { buyerCli, readJournal, verifyCli } from "../lib/actors.ts";
import { units } from "../lib/budget.ts";
import { ARC } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { gatewayAvailable, gatewayWallet } from "../lib/gateway.ts";
import { sleep } from "../lib/http.ts";

const MAX_PRICE = 50_000n;

export const publicGateway: Flow = {
  name: "public-gateway",
  title: "A Gateway nanopayment through the public hub",
  owner: "orch-cs",
  network: "arc",
  notRun: () => "retired: the Gateway rail was removed from production by flag (captain, 23:40 IST): it debits before the seller runs and cannot be reversed",
  spends: (env) => [{ wallet: gatewayWallet(env), amount: MAX_PRICE, floor: units("0.10", 6) }],
  async run(ctx) {
    const s = ctx.env.secrets;
    const base = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const buyer = s.address("CS_BUYER_ADDRESS");
    const state = join(ctx.dir, "buyer-state");

    const listing = await ctx.step("the public hub lists a live Gateway offer", async () => {
      const res = await ctx.http("public offers", `${base}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: { offerHash: Hex; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
      const l = offers.find((x) => x.online && x.status === "listed" && x.offer.rails.includes("gateway") && BigInt(x.offer.price) <= MAX_PRICE);
      check(l, `the public hub has no online Gateway offer at or under 0.05 USDC (it lists ${offers.length})`);
      sameHex(canonicalHash(l.offer), l.offerHash, "the offer hashes to its offerHash");
      ctx.note(`paid ${l.offer.title} ${l.offerHash.slice(0, 10)} from seller ${l.offer.seller}`);
      return l;
    });
    const price = BigInt(listing.offer.price);
    const seller = listing.offer.seller as Address;

    await ctx.step("envelope approves", async () => {
      const r = await buyerCli(ctx, "envelope", base, state, "CS_BUYER_KEY", ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", "--allow", seller.toLowerCase()]);
      equal(r.code, 0, "envelope set exit code");
    });

    const before = await ctx.step("buyer's Gateway balance before", () => gatewayAvailable(s, buyer, (why) => ctx.note(`a Gateway balance read was repeated after a transport failure: ${why}`)));

    const slipHash = await ctx.step("buyer pays through Gateway on the public hub", async () => {
      const r = await buyerCli(ctx, "buy", base, state, "CS_BUYER_KEY", ["buy", listing.offerHash, "--input", "{}", "--rail", "gateway"]);
      equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 300))})`);
      const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === listing.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,settled", "journal kinds");
      equal(mine[2]?.rail, "gateway", "journal rail");
      check(mine[2]?.slipHash, "journal carries the slip hash");
      return mine[2].slipHash as Hex;
    });

    await ctx.step("Gateway debits the buyer at once", async () => {
      let after = before;
      for (let i = 0; i < 10 && before - after < price; i++) {
        after = await gatewayAvailable(s, buyer, (why) => ctx.note(`a Gateway balance read was repeated after a transport failure: ${why}`));
        if (before - after < price) await sleep(1500);
      }
      equal(before - after, price, "Gateway balance drop");
    });

    await ctx.step("the public hub serves the same slip, and it verifies", async () => {
      const slip = JSON.parse(readFileSync(join(state, "slips", `${slipHash}.json`), "utf8")) as Slip;
      const res = await ctx.http("public slip", `${base}/slips/${slipHash}`);
      equal(res.status, 200, "slip status");
      equal(canonicalJson(slip), canonicalJson(res.json), "the buyer's slip equals the hosted hub's");
      equal(slip.body.rail, "gateway", "slip rail");
      ctx.note(`Gateway transfer ${slip.settlement.transaction}`);
      const path = ctx.save("slip.json", slip);
      const v = await verifyCli(ctx, "public-gateway", path, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
    });
  },
};
