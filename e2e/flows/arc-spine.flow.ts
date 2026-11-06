/**
 * 1 · Arc cold spine. A buyer agent finds an offer, its envelope approves, it countersigns, the
 * escrow is funded, the seller delivers, the escrow releases, a slip is minted. Then the hub is
 * stopped and the slip still verifies from a public RPC.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { canonicalJson, type Slip } from "@countersign/core";
import { buyerCli, readJournal, startHub, startSkillSeller, USE_ARC, verifyCli } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, escrowEvents, explorerTx, JOB, jobOf, receipt, sameAddress, tokenBalance, tokenTransfers, tollOf, treasuryOf } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { linkStatus, portClosed } from "../lib/http.ts";

export const PRICE = 10_000n; // 0.01 USDC
const GAS_PER_TX = units("0.01", 18); // Arc gas is USDC; a fund or release is far under this

export interface ArcSlipShare {
  slip: Slip;
  path: string;
  jobId: Hex;
}

export const arcSpine: Flow = {
  name: "arc-spine",
  title: "Arc cold spine",
  owner: "orch-cs",
  network: "arc",
  spends(env) {
    const w = wallets(env.secrets);
    return [
      { wallet: w.arcBuyer(), amount: PRICE, floor: units("0.10", 6) },
      { wallet: w.arcSubmitter(), amount: 2n * GAS_PER_TX, floor: units("0.10", 18) },
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const buyer = s.address("CS_BUYER_ADDRESS");
    const state = join(ctx.dir, "buyer-state");

    const hub = await ctx.step("hub up", () => startHub(ctx, { arc: true }));
    const seller = await ctx.step("seller publishes use-arc", () =>
      startSkillSeller(ctx, hub, { item: USE_ARC, price: PRICE, deadline: 120, rails: ["escrow"], key: "E2E_SELLER_KEY" }),
    );

    await ctx.step("buyer discovers", async () => {
      const r = await buyerCli(ctx, "discover", hub.url, state, "CS_BUYER_KEY", ["discover"]);
      equal(r.code, 0, `discover exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 200))})`);
      const line = r.stdout.split("\n").find((l) => l.startsWith(seller.offerHash.slice(0, 10)));
      check(line, `discover lists ${seller.offerHash.slice(0, 10)}`);
      check(line.includes(seller.offer.title) && line.includes("0.01 USDC") && line.includes("online"), `discover line reads ${JSON.stringify(line)}`);
    });

    await ctx.step("envelope approves", async () => {
      const r = await buyerCli(ctx, "envelope", hub.url, state, "CS_BUYER_KEY", [
        "envelope", "set", "--cap", "0.05", "--per-merchant", "0.02", "--allow", seller.seller.toLowerCase(),
      ]);
      equal(r.code, 0, "envelope set exit code");
      check(r.stdout.includes("Envelope saved."), `envelope set says ${JSON.stringify(r.stdout.trim())}`);
      const env = JSON.parse(readFileSync(join(state, "envelope.json"), "utf8")) as { agent: string; cap: string; perMerchant: string; allowlist: string[]; revoked: boolean };
      check(sameAddress(env.agent, buyer), "envelope agent is the buyer key");
      equal(env.cap, "50000", "envelope cap");
      equal(env.perMerchant, "20000", "envelope per-seller limit");
      check(env.allowlist.includes(seller.seller.toLowerCase()), "envelope allowlist names the seller");
      equal(env.revoked, false, "envelope revoked");
    });

    const sellerBefore = await ctx.step("seller balance before", () => tokenBalance(ARC, seller.seller));

    const bought = await ctx.step("countersign, fund, deliver, release", async () => {
      const r = await buyerCli(ctx, "buy", hub.url, state, "CS_BUYER_KEY", ["buy", seller.offerHash, "--input", "{}"]);
      equal(r.code, 0, `buy exit code (stderr ${JSON.stringify(r.stderr.trim().slice(0, 300))})`);
      check(r.stdout.includes("Released. Slip minted."), "buy prints Released. Slip minted.");
      const slipHash = /^slip (0x[0-9a-f]{64})$/m.exec(r.stdout)?.[1] as Hex | undefined;
      const closeTx = /^close tx (0x[0-9a-f]{64})$/m.exec(r.stdout)?.[1] as Hex | undefined;
      check(slipHash && closeTx, "buy prints the slip hash and the close tx");
      const mine = readJournal(state).filter((e) => e.offerHash?.toLowerCase() === seller.offerHash.toLowerCase());
      equal(mine.map((e) => e.kind).join(","), "countersigned,signed,released", "journal kinds for this offer");
      const signed = mine[1];
      const released = mine[2];
      check(signed?.jobId && released?.jobId, "journal carries the job id");
      sameHex(released.jobId, signed.jobId, "released job id");
      sameHex(released.slipHash, slipHash, "journal slip hash");
      sameHex(released.closeTx, closeTx, "journal close tx");
      equal(released.rail, "escrow", "journal rail");
      return { jobId: signed.jobId as Hex, slipHash, releaseTx: closeTx };
    });
    const { jobId, slipHash, releaseTx } = bought;

    const job = await ctx.step("hub job record", async () => {
      const res = await ctx.http("job", `${hub.url}/jobs/${jobId}`);
      equal(res.status, 200, "job status code");
      const j = res.json as { status: string; settleTx: Hex; closeTx: Hex; slipHash: Hex; rail: string };
      equal(j.status, "released", "hub job status");
      equal(j.rail, "escrow", "hub job rail");
      sameHex(j.closeTx, releaseTx, "hub close tx");
      sameHex(j.slipHash, slipHash, "hub slip hash");
      check(/^0x[0-9a-fA-F]{64}$/.test(j.settleTx), "hub records the fund tx");
      return j;
    });
    ctx.tx("arc", "fund", job.settleTx);
    ctx.tx("arc", "release", releaseTx);

    await ctx.step("chain agrees", async () => {
      const fund = await receipt(ARC, job.settleTx);
      equal(fund.status, "success", "fund receipt status");
      const funded = escrowEvents(ARC, fund).funded;
      equal(funded.length, 1, "Funded events in the fund tx");
      const f = funded[0]!;
      sameHex(f.jobId, jobId, "Funded.jobId");
      sameHex(f.offerHash, seller.offerHash, "Funded.offerHash");
      check(sameAddress(f.buyer, buyer), `Funded.buyer is the buyer (${f.buyer})`);
      check(sameAddress(f.payee, seller.seller), `Funded.payee is the seller (${f.payee})`);
      equal(f.amount, PRICE, "Funded.amount");
      check(
        tokenTransfers(ARC, fund).some((t) => sameAddress(t.from, buyer) && sameAddress(t.to, ARC.escrow) && t.value === PRICE),
        "the fund tx moves the price from the buyer to the escrow",
      );

      const rel = await receipt(ARC, releaseTx);
      equal(rel.status, "success", "release receipt status");
      const released = escrowEvents(ARC, rel).released;
      equal(released.length, 1, "Released events in the release tx");
      const r = released[0]!;
      sameHex(r.jobId, jobId, "Released.jobId");
      sameHex(r.slipHash, slipHash, "Released.slipHash");
      check(sameAddress(r.payee, seller.seller), "Released.payee is the seller");
      equal(r.paid + r.toll, PRICE, "Released paid + toll");
      equal(r.toll, await tollOf(ARC, PRICE), "Released.toll equals tollOf(price)");
      const treasury = await treasuryOf(ARC);
      const out = tokenTransfers(ARC, rel);
      check(out.some((t) => sameAddress(t.from, ARC.escrow) && sameAddress(t.to, seller.seller) && t.value === r.paid), "escrow pays the seller");
      if (r.toll > 0n) check(out.some((t) => sameAddress(t.from, ARC.escrow) && sameAddress(t.to, treasury) && t.value === r.toll), "escrow pays the toll to the treasury");

      const onchain = await jobOf(ARC, jobId);
      equal(onchain.status, JOB.Released, "jobOf status");
      sameHex(onchain.slipHash, slipHash, "jobOf slipHash");
      const sellerAfter = await tokenBalance(ARC, seller.seller);
      equal(sellerAfter - sellerBefore, r.paid, "seller balance rose by paid");
    });

    const slipPath = await ctx.step("slip names its rail", async () => {
      const saved = JSON.parse(readFileSync(join(state, "slips", `${slipHash}.json`), "utf8")) as Slip;
      const res = await ctx.http("slip", `${hub.url}/slips/${slipHash}`);
      equal(res.status, 200, "slip status code");
      equal(canonicalJson(saved), canonicalJson(res.json), "the buyer's slip equals the hub's");
      equal(saved.body.rail, "escrow", "slip rail");
      equal(saved.body.network, `eip155:${ARC.chainId}`, "slip network");
      sameHex(saved.body.escrow, ARC.escrow, "slip escrow");
      equal(saved.body.chainId, ARC.chainId, "slip chain id");
      sameHex(saved.settlement.transaction, releaseTx, "slip settlement tx");
      equal(saved.settlement.url, explorerTx("arc", releaseTx), "slip settlement link");
      equal(await linkStatus(saved.settlement.url ?? ""), 200, `the slip's explorer link opens (${saved.settlement.url})`);
      const path = ctx.save("slip.json", saved);
      ctx.share("arc.slip", { slip: saved, path, jobId } satisfies ArcSlipShare);
      return path;
    });

    await ctx.step("hub stopped", async () => {
      await hub.proc.stop();
      check(await portClosed(hub.port), "the hub's port still answers");
    });

    await ctx.step("verifier VALID with the hub stopped", async () => {
      const v = await verifyCli(ctx, "genuine", slipPath, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
      equal(v.code, 0, "verifier exit code");
      for (const name of ["hash", "seller", "terms", "countersignature", "escrow", "onchain"]) {
        equal(v.checks.get(name), "ok", `verifier check ${name}`);
      }
      equal(v.skipped.length, 0, "verifier skipped checks");
    });
  },
};
