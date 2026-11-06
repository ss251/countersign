/**
 * 3 · Arc deadline refund. The buyer pays, the seller cannot deliver, and the hub says the money
 * returns at the deadline. The hub is then stopped, so nothing of ours sweeps the job; after the
 * deadline a stranger refunds it and the full amount goes back to the buyer.
 */

import { join } from "node:path";
import type { Hex } from "viem";
import { buyerCli, readJournal, startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, disputeWindowOf, escrowEvents, JOB, jobOf, reader, receipt, revertOf, sameAddress, tokenTransfers, waitChainTimePast, writer } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { portClosed } from "../lib/http.ts";
import { escrowAbi } from "@countersign/rail";
import { PRICE } from "./arc-spine.flow.ts";

const DEADLINE_SECONDS = 45;
const FAILED_DELIVERY = "Refused. The seller's output does not match the offer. Your money returns at the deadline.";

export const arcDeadlineRefund: Flow = {
  name: "arc-deadline-refund",
  title: "Arc deadline refund by a stranger",
  owner: "orch-cs",
  network: "arc",
  onDemand:
    ARC.escrowVersion === 2
      ? "on escrow v2 it waits the 600 s settle window; run it with --with arc-deadline-refund"
      : undefined,
  timeoutMs: ARC.escrowVersion === 2 ? 15 * 60_000 : undefined,
  spends(env) {
    const w = wallets(env.secrets);
    return [
      // Locked for the deadline, then returned by the refund.
      { wallet: w.arcBuyer(), amount: PRICE, floor: units("0.10", 6) },
      { wallet: w.arcSubmitter(), amount: units("0.01", 18), floor: units("0.10", 18) },
      { wallet: w.arcStranger(), amount: units("0.01", 18), floor: units("0.05", 18) },
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const buyer = s.address("CS_BUYER_ADDRESS");
    const stranger = s.account("E2E_STRANGER_KEY");
    const submitter = s.address("E2E_ARC_SUBMITTER_ADDRESS");
    const state = join(ctx.dir, "buyer-state");

    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step(`seller publishes use-arc with a ${DEADLINE_SECONDS} s deadline`, () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: DEADLINE_SECONDS, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );
    check(!sameAddress(stranger.address, buyer) && !sameAddress(stranger.address, seller.seller) && !sameAddress(stranger.address, submitter), "the stranger is not the buyer, the seller or the hub");

    await ctx.step("envelope approves", async () => {
      const r = await buyerCli(ctx, "envelope", hub.url, state, "CS_BUYER_KEY", [
        "envelope", "set", "--cap", "0.05", "--per-merchant", "0.02", "--allow", seller.seller.toLowerCase(),
      ]);
      equal(r.code, 0, "envelope set exit code");
    });

    const jobId = await ctx.step("buyer pays, seller cannot deliver", async () => {
      // A section the skill does not have: the runner refuses the job after the escrow is funded.
      const input = JSON.stringify({ section: `no such section ${ctx.env.runId}` });
      const r = await buyerCli(ctx, "buy", hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", input]);
      equal(r.code, 1, "buy exit code");
      check(r.stderr.includes(FAILED_DELIVERY), `buy says ${JSON.stringify(r.stderr.trim().slice(0, 300))}`);
      const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === seller.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,failed", "journal kinds for this offer");
      const id = mine[1]?.jobId;
      check(id, "journal carries the job id");
      sameHex(mine[2]?.jobId, id, "failed entry job id");
      return id as Hex;
    });

    const deadline = await ctx.step("escrow holds the money", async () => {
      const res = await ctx.http("job", `${hub.url}/jobs/${jobId}`);
      equal(res.status, 200, "job status code");
      const j = res.json as { status: string; settleTx: Hex; deadline: number };
      equal(j.status, "failed", "hub job status");
      ctx.tx("arc", "fund", j.settleTx);
      const fund = await receipt(ARC, j.settleTx);
      equal(fund.status, "success", "fund receipt status");
      const funded = escrowEvents(ARC, fund).funded;
      equal(funded.length, 1, "Funded events");
      sameHex(funded[0]!.jobId, jobId, "Funded.jobId");
      equal(funded[0]!.amount, PRICE, "Funded.amount");
      const job = await jobOf(ARC, jobId);
      equal(job.status, JOB.Funded, "jobOf status");
      equal(job.amount, PRICE, "jobOf amount");
      check(sameAddress(job.buyer, buyer), "jobOf buyer");
      equal(job.deadline, BigInt(j.deadline), "on-chain deadline equals the hub's");
      return job.deadline;
    });
    // v2 opens the refund only after the settle window: deadline + DISPUTE_WINDOW (600 s).
    const settleBy = ARC.escrowVersion === 2 ? deadline + (await disputeWindowOf(ARC)) : deadline;
    const settleWindow = settleBy - deadline;

    await ctx.step("hub stopped", async () => {
      await hub.proc.stop();
      check(await portClosed(hub.port), "the hub's port still answers");
    });

    await ctx.step("a refund before the deadline is refused", async () => {
      const now = (await reader(ARC).getBlock({ blockTag: "latest" })).timestamp;
      if (now >= settleBy - 2n) {
        ctx.note("the refund window was already near when this step ran, so the early-refund call was not made");
        return;
      }
      const why = await revertOf(ARC, stranger.address, "refund", [jobId]);
      check(why, "an early refund would succeed");
      equal(why.errorName, ARC.escrowVersion === 2 ? "SettleWindowOpen" : "DeadlineNotReached", "early refund revert reason");
    });

    await ctx.step("chain passes the deadline", () =>
      waitChainTimePast(ARC, settleBy, (DEADLINE_SECONDS + Number(settleWindow) + 120) * 1000),
    );

    await ctx.step("a stranger refunds", async () => {
      const hash = await writer(ARC, stranger).writeContract({ address: ARC.escrow, abi: escrowAbi, functionName: "refund", args: [jobId] });
      ctx.tx("arc", "refund by a stranger", hash);
      const rcpt = await receipt(ARC, hash);
      equal(rcpt.status, "success", "refund receipt status");
      check(sameAddress(rcpt.from, stranger.address), "the refund was sent by the stranger");
      const refunded = escrowEvents(ARC, rcpt).refunded;
      equal(refunded.length, 1, "Refunded events");
      const r = refunded[0]!;
      sameHex(r.jobId, jobId, "Refunded.jobId");
      check(sameAddress(r.buyer, buyer), "Refunded.buyer");
      equal(r.amount, PRICE, "Refunded.amount is the full price");
      equal(r.byPayee, false, "Refunded.byPayee");
      check(
        tokenTransfers(ARC, rcpt).some((t) => sameAddress(t.from, ARC.escrow) && sameAddress(t.to, buyer) && t.value === PRICE),
        "the full price moves from the escrow back to the buyer",
      );
      equal((await jobOf(ARC, jobId)).status, JOB.Refunded, "jobOf status");
    });

    await ctx.step("the refund is final", async () => {
      const why = await revertOf(ARC, stranger.address, "refund", [jobId]);
      check(why, "a second refund would succeed");
      equal(why.errorName, "NotFunded", "second refund revert reason");
    });
  },
};
