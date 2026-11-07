/**
 * 6 · Hedera. A seller lists an offer that pays a Hedera account. The paying agent finds it
 * through the hub, pays it over x402 through the facilitator with no human step, and logs the
 * spend on its HCS topic. The suite then reads the mirror node itself: the transfer, the memo,
 * the log entry. Last, the agent's envelope refuses a call past its cap and logs that too.
 */

import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  type PaymentRequired,
} from "@countersign/core";
import { startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { HEDERA } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow } from "../lib/flow.ts";
import { hashscanTx, mirrorTransaction, mirrorTxId, netToken, tokenDebits, topicMessage, topicSince } from "../lib/hedera.ts";
import { sleep } from "../lib/http.ts";
import { agentRun, evidence as find, hederaExact, OPEN_CAP } from "../lib/agent.ts";

const PRICE = 10_000n; // 0.01 USDC

export const hedera: Flow = {
  name: "hedera",
  title: "Hedera agent-paid call and HCS spend log",
  owner: "cs-hd",
  network: "hedera",
  onDemand: "covered hourly by flow 17; HBAR budget",
  spends(env) {
    const w = wallets(env.secrets);
    return [
      { wallet: w.hdAgentUsdc(), amount: PRICE, floor: units("0.10", 6) },
      // Two HCS messages, well under 0.01 HBAR each; the facilitator pays the transfer fee.
      { wallet: w.hdAgentHbar(), amount: units("0.01", 8), floor: units("0.5", 8) }, // the facilitator pays the transfer fee; the agent pays its HCS entries
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const agentId = s.get("HD_AGENT_ID");
    const sellerAccount = s.get("HD_SELLER_ID");
    const topicId = s.get("HD_TOPIC_ID");
    // The window this run reconciles: a little before its first payment.
    const since = Math.floor(Date.now() / 1000) - 5;

    const hub = await ctx.step("hub up with the Hedera rail", () => startHub(ctx, { hedera: true }));
    const seller = await ctx.step("seller lists an offer paid on Hedera", () =>
      startSkillSeller(ctx, hub, {
        item: USE_ARC,
        price: PRICE,
        deadline: 120,
        rails: ["hedera"],
        payTo: { hedera: sellerAccount },
        key: "E2E_SELLER_KEY",
      }),
    );

    await ctx.step("402 names the Hedera rail", async () => {
      equal(seller.offer.payTo?.hedera, sellerAccount, "offer pays the Hedera seller account");
      const res = await ctx.http("unpaid call", `${hub.url}/offers/${seller.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      equal(res.status, 402, "unpaid call status");
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      check(header, "402 carries PAYMENT-REQUIRED");
      const required = fromBase64Json<PaymentRequired>(header);
      const e = hederaExact(required);
      check(e, `the 402 accepts hedera:testnet, scheme exact (it accepts ${required.accepts.map((a) => `${a.network}/${a.scheme}`).join(", ")})`);
      equal(e.scheme, "exact", "Hedera scheme");
      equal(e.payTo, sellerAccount, "Hedera payee");
      equal(e.asset, HEDERA.usdc, "Hedera asset is USDC");
      equal(e.amount, PRICE.toString(), "Hedera amount");
      check(typeof e.extra?.feePayer === "string", "the challenge names the facilitator's fee payer");
    });

    const paid = await ctx.step("agent pays with no human step", async () => {
      const run = await agentRun(ctx, "pay", hub.url, OPEN_CAP);
      equal(run.code, 0, `agent exit code (stderr ${JSON.stringify(run.stderr.trim().slice(-300))})`);
      equal(run.ok, true, "agent evidence ok");
      sameHex(String(find(run.evidence, "offer").value), seller.offerHash, "the agent bought this offer");
      const payment = find(run.evidence, "payment");
      const tx = String(payment.value);
      equal(payment.url, hashscanTx(tx), "payment HashScan link");
      const log = String(find(run.evidence, "spend log").value);
      check(/^#\d+$/.test(log), `spend log sequence ${log}`);
      ctx.tx("hedera", "agent payment", tx);
      ctx.note(`facilitator: ${find(run.evidence, "facilitator").value}`);
      return { tx, sequence: Number(log.slice(1)) };
    });

    await ctx.step("mirror node confirms the transfer", async () => {
      const t = await mirrorTransaction(paid.tx);
      equal(t.result, "SUCCESS", "mirror result");
      equal(netToken(t, HEDERA.usdc, agentId), -PRICE, "agent USDC movement");
      equal(netToken(t, HEDERA.usdc, sellerAccount), PRICE, "seller USDC movement");
      equal(t.memo, `cs1:${seller.offerHash.slice(2).toLowerCase()}`, "transfer memo names the offer");
    });

    await ctx.step("spend log entry on HCS", async () => {
      const m = await topicMessage(topicId, paid.sequence);
      const entry = m.json as { kind?: string; offerHash?: string; amount?: string; tx?: string; rail?: string };
      ctx.save("hcs-spend.json", m);
      equal(entry.kind, "spend", "log entry kind");
      equal(entry.rail, "hedera", "log entry rail");
      sameHex(entry.offerHash ?? "", seller.offerHash, "log entry offer");
      equal(entry.amount, PRICE.toString(), "log entry amount");
      equal(mirrorTxId(entry.tx ?? ""), mirrorTxId(paid.tx), "log entry names this payment");
      equal(m.payerAccount, agentId, "the agent submitted the entry");
      ctx.note(`spend log: topic ${topicId} sequence ${paid.sequence}`);
    });

    await ctx.step("envelope refuses past its cap, and logs it", async () => {
      const run = await agentRun(ctx, "over-cap", hub.url, "1");
      equal(run.ok, true, "a logged refusal is ok");
      const refusal = find(run.evidence, "refusal");
      check(String(refusal.value).length > 0, "the refusal has a message");
      check(!run.evidence.some((e) => e.label === "payment"), "nothing was paid past the cap");
      const seq = String(find(run.evidence, "refusal log").value);
      const m = await topicMessage(topicId, Number(seq.slice(1)));
      const entry = m.json as { kind?: string; reason?: string; offerHash?: string };
      equal(entry.kind, "refused", "refusal entry kind");
      equal(entry.reason, "over-cap", "refusal reason");
      sameHex(entry.offerHash ?? "", seller.offerHash, "refusal entry offer");
    });

    await ctx.step("the spend log is complete for this run", async () => {
      // Every USDC the agent paid in this window is backed by a log entry naming its transaction:
      // a spend, or a schedule whose transfer executed later under the create's id (looked for
      // up to two hours back). Every spend entry written in the window is backed by a payment.
      // A schedule entry may not have executed yet, and an expired one moved nothing.
      let debits = await tokenDebits(agentId, HEDERA.usdc, since);
      for (let i = 0; i < 10 && !debits.some((d) => mirrorTxId(d.txId) === mirrorTxId(paid.tx)); i++) {
        await sleep(3000);
        debits = await tokenDebits(agentId, HEDERA.usdc, since);
      }
      const messages = await topicSince(topicId, since - 7200);
      const backing = messages
        .map((m) => ({ at: Number(m.consensusTimestamp.split(".")[0]), e: m.json as { kind?: string; tx?: string; amount?: string } }))
        .filter((x) => (x.e.kind === "spend" || x.e.kind === "schedule") && typeof x.e.tx === "string");
      const inWindow = backing.filter((x) => x.e.kind === "spend" && x.at >= since);
      ctx.save("reconcile.json", { since, debits, backing });
      check(debits.some((d) => mirrorTxId(d.txId) === mirrorTxId(paid.tx)), "the mirror lists this run's payment as an agent debit");
      for (const d of debits) {
        const b = backing.find((x) => mirrorTxId(x.e.tx as string) === mirrorTxId(d.txId));
        check(b, `agent payment ${d.txId} has no spend or schedule entry on the log`);
        equal(b.e.amount, d.amount.toString(), `logged amount for ${d.txId}`);
      }
      for (const x of inWindow) {
        check(debits.some((d) => mirrorTxId(d.txId) === mirrorTxId(x.e.tx as string)), `spend entry ${x.e.tx} has no agent payment behind it`);
      }
      ctx.note(`reconciled ${debits.length} agent payment(s) against ${backing.length} spend or schedule entr${backing.length === 1 ? "y" : "ies"}`);
    });
  },
};
