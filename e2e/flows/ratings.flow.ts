/**
 * 13 · Ratings and stats from slips (#20). A seller's rating is derived from what the hub can
 * prove: a delivery counts only with a slip, a failed delivery and a refund count against it,
 * and a sale to itself counts for nothing. The hub's own janitor then refunds the failed job
 * after its deadline, and the rating follows.
 */

import { join } from "node:path";
import type { Hex } from "viem";
import { buyerCli, readJournal, startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { units, wallets, type Wallet } from "../lib/budget.ts";
import { ARC, disputeWindowOf, escrowEvents, JOB, jobOf, receipt, sameAddress, tokenBalance, waitChainTimePast } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { sleep } from "../lib/http.ts";
import { PRICE } from "./arc-spine.flow.ts";

const DEADLINE_SECONDS = 45;

interface RatingView {
  delivered: number;
  failed: number;
  refunded: number;
  open: number;
  unverified: number;
  selfDealt: number;
  closed: number;
  score: number | null;
  buyers: number;
  volume: string;
}

function expectRating(r: RatingView, want: Partial<RatingView>, what: string): void {
  for (const [k, v] of Object.entries(want)) equal(r[k as keyof RatingView], v, `${what} ${k}`);
}

async function buy(ctx: FlowCtx, hubUrl: string, label: string, key: string, sellerAddr: string, offerHash: Hex, input: string) {
  const state = join(ctx.dir, `buyer-state-${label}`);
  await buyerCli(ctx, `${label}-envelope`, hubUrl, state, key, ["envelope", "set", "--cap", "0.05", "--per-merchant", "0.05", "--allow", sellerAddr.toLowerCase()]);
  const r = await buyerCli(ctx, `${label}-buy`, hubUrl, state, key, ["buy", offerHash, "--input", input]);
  const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === offerHash.toLowerCase());
  return { r, jobId: mine.find((e) => e.kind === "signed")?.jobId as Hex | undefined };
}

export const ratings: Flow = {
  name: "ratings",
  title: "Ratings and stats derived from slips",
  owner: "orch-cs",
  network: "arc",
  onDemand:
    ARC.escrowVersion === 2
      ? "on escrow v2 it waits the 600 s settle window; run it with --with ratings"
      : undefined,
  timeoutMs: ARC.escrowVersion === 2 ? 15 * 60_000 : undefined,
  spends(env) {
    const w = wallets(env.secrets);
    const seller: Wallet = { ...w.arcBuyer(), id: "arc.seller.usdc", label: "Arc e2e seller", address: env.secrets.address("E2E_SELLER_ADDRESS"), read: () => tokenBalance(ARC, env.secrets.address("E2E_SELLER_ADDRESS")) };
    return [
      // One sale, and one failed call whose money the janitor returns.
      { wallet: w.arcBuyer(), amount: 2n * PRICE, floor: units("0.10", 6) },
      // The seller buys from itself once; it gets the price back less the toll.
      { wallet: seller, amount: PRICE, floor: 0n },
      { wallet: w.arcSubmitter(), amount: units("0.03", 18), floor: units("0.10", 18) },
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step(`seller publishes use-arc with a ${DEADLINE_SECONDS} s deadline`, () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: DEADLINE_SECONDS, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );

    await ctx.step("a buyer's call is delivered", async () => {
      const { r } = await buy(ctx, hub.url, "delivered", "CS_BUYER_KEY", seller.seller, seller.offerHash, "{}");
      equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 200))})`);
    });
    await ctx.step("the seller buys from itself", async () => {
      const { r } = await buy(ctx, hub.url, "self", "E2E_SELLER_KEY", seller.seller, seller.offerHash, "{}");
      equal(r.code, 0, `self-dealt buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 200))})`);
    });
    const failedJob = await ctx.step("a buyer's call fails delivery", async () => {
      const { r, jobId } = await buy(ctx, hub.url, "failed", "CS_BUYER_KEY", seller.seller, seller.offerHash, JSON.stringify({ section: `no such section ${ctx.env.runId}` }));
      equal(r.code, 1, "failed buy exit code");
      check(jobId, "the failed call has a job id");
      return jobId;
    });

    const view = async (label: string) => {
      const res = await ctx.http(label, `${hub.url}/ratings/${seller.seller}`);
      equal(res.status, 200, `${label} status`);
      return res.json as RatingView & { seller: string; offers: Array<RatingView & { offerHash: string }> };
    };

    await ctx.step("the seller's rating counts what the slips prove", async () => {
      const r = await view("rating");
      check(sameAddress(r.seller, seller.seller), "rating seller");
      expectRating(r, { delivered: 1, failed: 1, refunded: 0, open: 0, unverified: 0, selfDealt: 1, closed: 2, score: 0.5, buyers: 1, volume: PRICE.toString() }, "rating");
      const offer = r.offers.find((o) => o.offerHash.toLowerCase() === seller.offerHash.toLowerCase());
      check(offer, "the rating lists the offer");
      expectRating(offer, { delivered: 1, failed: 1, selfDealt: 1, score: 0.5 }, "offer rating");
      const all = await ctx.http("ratings", `${hub.url}/ratings`);
      const listed = (all.json as { ratings: Array<{ seller: string; score: number | null }> }).ratings.find((x) => sameAddress(x.seller, seller.seller));
      equal(listed?.score, 0.5, "the ratings list agrees");
    });

    await ctx.step("hub stats agree", async () => {
      const res = await ctx.http("stats", `${hub.url}/stats`);
      equal(res.status, 200, "stats status");
      const st = res.json as RatingView & { calls: number; sellers: number; offers: { listed: number }; runnersOnline: number; byRail: Record<string, { calls: number; delivered: number; volume: string }> };
      expectRating(st, { delivered: 1, failed: 1, refunded: 0, selfDealt: 1, closed: 2, score: 0.5, volume: PRICE.toString() }, "stats");
      equal(st.calls, 3, "stats calls");
      equal(st.sellers, 1, "stats sellers");
      equal(st.offers.listed, 1, "stats listed offers");
      equal(st.runnersOnline, 1, "stats runners online");
      equal(st.byRail.escrow?.calls, 3, "escrow rail calls");
      equal(st.byRail.escrow?.delivered, 1, "escrow rail deliveries");
    });

    await ctx.step("the hub's janitor refunds the failed call after its deadline", async () => {
      const job = await jobOf(ARC, failedJob);
      equal(job.status, JOB.Funded, "the failed call's money is still in escrow");
      // The janitor's v2 refund opens only after deadline + DISPUTE_WINDOW (600 s).
      const settleBy = ARC.escrowVersion === 2 ? job.deadline + (await disputeWindowOf(ARC)) : job.deadline;
      const settleWindow = settleBy - job.deadline;
      await waitChainTimePast(ARC, settleBy, (DEADLINE_SECONDS + Number(settleWindow) + 60) * 1000);
      let status = "";
      let closeTx: Hex | null = null;
      for (let i = 0; i < 30 && status !== "refunded"; i++) {
        const res = await ctx.http("failed job", `${hub.url}/jobs/${failedJob}`);
        const j = res.json as { status: string; closeTx: Hex | null };
        status = j.status;
        closeTx = j.closeTx;
        if (status !== "refunded") await sleep(3000);
      }
      equal(status, "refunded", "hub job status after the sweep");
      check(closeTx, "the hub records the refund tx");
      ctx.tx("arc", "refund by the hub's janitor", closeTx);
      const rcpt = await receipt(ARC, closeTx);
      const refunded = escrowEvents(ARC, rcpt).refunded;
      equal(refunded.length, 1, "Refunded events");
      sameHex(refunded[0]!.jobId, failedJob, "Refunded.jobId");
      equal(refunded[0]!.amount, PRICE, "Refunded.amount");
      equal((await jobOf(ARC, failedJob)).status, JOB.Refunded, "jobOf status");
    });

    await ctx.step("the rating follows the refund", async () => {
      expectRating(await view("rating after refund"), { delivered: 1, failed: 0, refunded: 1, closed: 2, score: 0.5 }, "rating");
    });
  },
};
