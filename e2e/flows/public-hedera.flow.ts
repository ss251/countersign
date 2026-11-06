/**
 * 15 · A Hedera agent pays through the public hub. The hosted hub, its x402 facilitator and the
 * hosted seller's runner are the production ones. The agent finds a live Hedera offer, pays it
 * with no human step and logs the spend; the suite reads the mirror node, the HCS entry and the
 * hub's own settlement record, and verifies the slip.
 */

import { fromBase64Json, PAYMENT_REQUIRED_HEADER, canonicalHash, type Offer, type PaymentRequired, type Slip } from "@countersign/core";
import { verifyCli } from "../lib/actors.ts";
import { agentRun, evidence, hederaExact, OPEN_CAP } from "../lib/agent.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, HEDERA } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { hashscanTx, mirrorTransaction, mirrorTxId, netToken, topicMessage } from "../lib/hedera.ts";

const MAX_PRICE = 50_000n;

export const publicHedera: Flow = {
  name: "public-hedera",
  title: "A Hedera agent pays through the public hub",
  owner: "cs-hd",
  network: "hedera",
  notRun: () => "retired: plain x402 Hedera was removed from production by flag (project lead, 23:40 IST): it debits before the seller runs and cannot be reversed",
  spends(env) {
    const w = wallets(env.secrets);
    return [
      { wallet: w.hdAgentUsdc(), amount: MAX_PRICE, floor: units("0.10", 6) },
      { wallet: w.hdAgentHbar(), amount: units("0.01", 8), floor: units("0.5", 8) }, // the facilitator pays the transfer fee; the agent pays its HCS entries
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const base = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const agentId = s.get("HD_AGENT_ID");
    const topicId = s.get("HD_TOPIC_ID");

    const listing = await ctx.step("the public hub lists a live Hedera offer", async () => {
      const res = await ctx.http("public offers", `${base}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: { offerHash: string; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
      // The agent buys the first listed, online Hedera offer it discovers; so does this check.
      // A skill offer on the Hedera rail, paid with the empty input; the MCP offer has its own flow.
      const l = offers.find((x) => x.online && x.status === "listed" && x.offer.adapter === "skill" && x.offer.rails.includes("hedera") && typeof x.offer.payTo?.hedera === "string");
      check(l, `the public hub has no online skill offer payable on Hedera (it lists ${offers.length})`);
      check(BigInt(l.offer.price) <= MAX_PRICE, `the Hedera offer costs ${l.offer.price}, above the suite's 0.05 USDC`);
      sameHex(canonicalHash(l.offer), l.offerHash, "the offer hashes to its offerHash");
      ctx.note(`paid ${l.offer.title} ${l.offerHash.slice(0, 10)} to ${l.offer.payTo?.hedera}`);
      return l;
    });
    const price = BigInt(listing.offer.price);
    const payee = listing.offer.payTo?.hedera as string;

    await ctx.step("402 names the Hedera rail on production", async () => {
      const res = await ctx.http("unpaid call", `${base}/offers/${listing.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 402, "unpaid call status");
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      check(header, "402 carries PAYMENT-REQUIRED");
      const e = hederaExact(fromBase64Json<PaymentRequired>(header));
      check(e, "the 402 accepts hedera:testnet, scheme exact");
      equal(e.payTo, payee, "Hedera payee");
      equal(e.asset, HEDERA.usdc, "Hedera asset");
      equal(e.amount, price.toString(), "Hedera amount");
    });

    const paid = await ctx.step("agent pays through the public hub, no human step", async () => {
      const run = await agentRun(ctx, "public", base, OPEN_CAP, { offer: listing.offerHash });
      equal(run.code, 0, `agent exit code (stderr ${JSON.stringify(run.stderr.trim().slice(-300))})`);
      equal(run.ok, true, "agent evidence ok");
      sameHex(String(evidence(run.evidence, "offer").value), listing.offerHash, "the agent bought the live Hedera offer");
      const payment = evidence(run.evidence, "payment");
      const tx = String(payment.value);
      equal(payment.url, hashscanTx(tx), "payment HashScan link");
      const log = String(evidence(run.evidence, "spend log").value);
      check(/^#\d+$/.test(log), `spend log sequence ${log}`);
      ctx.tx("hedera", "agent payment through the public hub", tx);
      return { tx, sequence: Number(log.slice(1)) };
    });

    await ctx.step("mirror node confirms the transfer", async () => {
      const t = await mirrorTransaction(paid.tx);
      equal(t.result, "SUCCESS", "mirror result");
      equal(netToken(t, HEDERA.usdc, agentId), -price, "agent USDC movement");
      equal(netToken(t, HEDERA.usdc, payee), price, "payee USDC movement");
      equal(t.memo, `cs1:${listing.offerHash.slice(2).toLowerCase()}`, "transfer memo names the offer");
    });

    await ctx.step("spend log entry on HCS", async () => {
      const m = await topicMessage(topicId, paid.sequence);
      const entry = m.json as { kind?: string; offerHash?: string; amount?: string; tx?: string };
      equal(entry.kind, "spend", "log entry kind");
      sameHex(entry.offerHash ?? "", listing.offerHash, "log entry offer");
      equal(entry.amount, price.toString(), "log entry amount");
      equal(mirrorTxId(entry.tx ?? ""), mirrorTxId(paid.tx), "log entry names this payment");
    });

    await ctx.step("the public hub records the settlement and its slip verifies", async () => {
      const res = await ctx.http("public settlements", `${base}/settlements?limit=50`);
      equal(res.status, 200, "settlements status");
      const rows = (res.json as { settlements?: Array<{ rail: string; tx: string; slipHash?: string }> }).settlements ?? [];
      const row = rows.find((r) => r.rail === "hedera" && mirrorTxId(r.tx) === mirrorTxId(paid.tx));
      check(row?.slipHash, `the public hub lists no hedera settlement for ${paid.tx}`);
      const slipRes = await ctx.http("public slip", `${base}/slips/${row.slipHash}`);
      equal(slipRes.status, 200, "slip status");
      const slip = slipRes.json as Slip;
      equal(slip.body.rail, "hedera", "slip rail");
      equal(mirrorTxId(slip.settlement.transaction), mirrorTxId(paid.tx), "slip settlement");
      const path = ctx.save("slip.json", slip);
      const v = await verifyCli(ctx, "public-hedera", path, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
    });
  },
};
