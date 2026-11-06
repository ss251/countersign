/**
 * 12 · A purchase through the public hub, the one a judge opens. The buyer CLI on this machine
 * finds a live offer there, pays it on Arc and gets a slip that verifies with no hub at all.
 * The hub, its relayer and the seller's runner are the hosted ones, not the suite's.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { canonicalHash, type Offer, type Slip } from "@countersign/core";
import { buyerCli, readJournal, verifyCli } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, escrowEvents, JOB, jobOf, receipt, sameAddress } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { linkStatus } from "../lib/http.ts";

/** The most the suite pays for a public offer; the envelope caps it too. */
const MAX_PRICE = 50_000n;

export const publicSpine: Flow = {
  name: "public-spine",
  title: "A purchase through the public hub",
  owner: "orch-cs",
  network: "arc",
  notRun: (env) => (env.options.publicHub ? null : "no public hub configured"),
  spends: (env) => [{ wallet: wallets(env.secrets).arcBuyer(), amount: MAX_PRICE, floor: units("0.10", 6) }],
  async run(ctx) {
    const base = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const buyer = ctx.env.secrets.address("CS_BUYER_ADDRESS");
    const state = join(ctx.dir, "buyer-state");

    const listing = await ctx.step("the public hub lists a live Arc offer", async () => {
      const res = await ctx.http("public offers", `${base}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: { offerHash: Hex; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
      const live = offers.filter((l) => l.online && l.status === "listed" && l.offer.rails.includes("escrow") && BigInt(l.offer.price) <= MAX_PRICE);
      check(live.length > 0, `the public hub has no online Arc offer at or under 0.05 USDC (it lists ${offers.length})`);
      const l = live.find((x) => x.offer.title === "use-arc") ?? live[0]!;
      sameHex(canonicalHash(l.offer), l.offerHash, "the offer hashes to its offerHash");
      ctx.note(`bought ${l.offer.title} ${l.offerHash.slice(0, 10)} from seller ${l.offer.seller}`);
      return l;
    });
    const price = BigInt(listing.offer.price);
    const seller = listing.offer.seller as Address;

    await ctx.step("envelope approves", async () => {
      const r = await buyerCli(ctx, "envelope", base, state, "CS_BUYER_KEY", ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", "--allow", seller.toLowerCase()]);
      equal(r.code, 0, "envelope set exit code");
    });

    const bought = await ctx.step("buyer pays through the public hub", async () => {
      const r = await buyerCli(ctx, "buy", base, state, "CS_BUYER_KEY", ["buy", listing.offerHash, "--input", "{}"]);
      equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 300))})`);
      check(r.stdout.includes("Released. Slip minted."), "buy prints Released. Slip minted.");
      const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === listing.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,released", "journal kinds");
      const released = mine[2];
      check(released?.jobId && released.slipHash, "journal carries the job and slip");
      return { jobId: released.jobId as Hex, slipHash: released.slipHash as Hex };
    });

    await ctx.step("chain agrees", async () => {
      const res = await ctx.http("public job", `${base}/jobs/${bought.jobId}`);
      equal(res.status, 200, "job status code");
      const j = res.json as { status: string; settleTx: Hex; closeTx: Hex };
      equal(j.status, "released", "hub job status");
      ctx.tx("arc", "fund (public hub)", j.settleTx);
      ctx.tx("arc", "release (public hub)", j.closeTx);
      const fund = await receipt(ARC, j.settleTx);
      const f = escrowEvents(ARC, fund).funded;
      equal(f.length, 1, "Funded events");
      check(sameAddress(f[0]!.buyer, buyer) && sameAddress(f[0]!.payee, seller), "Funded names this buyer and that seller");
      equal(f[0]!.amount, price, "Funded.amount");
      const rel = await receipt(ARC, j.closeTx);
      const r = escrowEvents(ARC, rel).released;
      equal(r.length, 1, "Released events");
      sameHex(r[0]!.slipHash, bought.slipHash, "Released.slipHash");
      equal(r[0]!.paid + r[0]!.toll, price, "paid + toll");
      const job = await jobOf(ARC, bought.jobId);
      equal(job.status, JOB.Released, "jobOf status");
    });

    await ctx.step("slip verifies with no hub", async () => {
      const slip = JSON.parse(readFileSync(join(state, "slips", `${bought.slipHash}.json`), "utf8")) as Slip;
      equal(await linkStatus(slip.settlement.url ?? ""), 200, `the slip's explorer link opens (${slip.settlement.url})`);
      const path = ctx.save("slip.json", slip);
      const v = await verifyCli(ctx, "public", path, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
      equal(v.checks.get("onchain"), "ok", "verifier onchain check");
    });
  },
};
