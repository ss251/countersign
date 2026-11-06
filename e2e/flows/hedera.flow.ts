/**
 * 6 · Hedera. A seller lists an offer that pays a Hedera account. The paying agent finds it
 * through the hub, pays it over x402 through the facilitator with no human step, and logs the
 * spend on its HCS topic. The suite then reads the mirror node itself: the transfer, the memo,
 * the log entry. Last, the agent's envelope refuses a call past its cap and logs that too.
 */

import { join } from "node:path";
import {
  fromBase64Json,
  PAYMENT_REQUIRED_HEADER,
  type PaymentRequired,
} from "@countersign/core";
import { startHub, startSkillSeller, USE_ARC } from "../lib/actors.ts";
import { units, wallets } from "../lib/budget.ts";
import { HEDERA } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { hashscanTx, mirrorTransaction, mirrorTxId, netToken, topicMessage } from "../lib/hedera.ts";
import { runCmd } from "../lib/procs.ts";

const PRICE = 10_000n; // 0.01 USDC
/** Wide enough that the history already on the topic never trips the paid call. */
const OPEN_CAP = "1000000000";

interface Evidence {
  label: string;
  value: string | number;
  url?: string;
}

interface AgentRun {
  code: number;
  ok: boolean;
  evidence: Evidence[];
  stderr: string;
}

async function agentRun(ctx: FlowCtx, label: string, hub: string, cap: string): Promise<AgentRun> {
  const r = await runCmd(
    {
      name: `agent ${label}`,
      // The agent reads its own key from the Hedera env file; nothing is passed to it here.
      cmd: ["bun", "scripts/hedera/agent-run.ts", hub, "--cap", cap, "--per-merchant", cap, "--times", "1", "--json"],
      log: join(ctx.dir, `agent-${label}.log`),
      redact: (s) => ctx.env.secrets.redact(s),
    },
    180_000,
  );
  const last = r.stdout.trim().split("\n").at(-1) ?? "";
  let parsed: { beat?: string; ok?: boolean; evidence?: Evidence[] } = {};
  try {
    parsed = JSON.parse(last) as typeof parsed;
  } catch {
    throw new Error(`agent printed no JSON (exit ${r.code}; stderr ${JSON.stringify(r.stderr.trim().slice(-300))})`);
  }
  equal(parsed.beat, "hedera", "agent evidence beat");
  return { code: r.code, ok: parsed.ok === true, evidence: parsed.evidence ?? [], stderr: r.stderr };
}

function find(evidence: Evidence[], label: string): Evidence {
  const e = evidence.find((x) => x.label === label);
  check(e, `the agent reports ${label} (it reported ${evidence.map((x) => x.label).join(", ")})`);
  return e;
}

export const hedera: Flow = {
  name: "hedera",
  title: "Hedera agent-paid call and HCS spend log",
  owner: "cs-hd",
  network: "hedera",
  spends(env) {
    const w = wallets(env.secrets);
    return [
      { wallet: w.hdAgentUsdc(), amount: PRICE, floor: units("0.10", 6) },
      // Two HCS messages, well under 0.01 HBAR each; the facilitator pays the transfer fee.
      { wallet: w.hdAgentHbar(), amount: units("0.05", 8), floor: units("0.5", 8) },
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const agentId = s.get("HD_AGENT_ID");
    const sellerAccount = s.get("HD_SELLER_ID");
    const topicId = s.get("HD_TOPIC_ID");

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
      const e = required.accepts.find((a) => a.network === "hedera:testnet");
      check(e, `the 402 accepts hedera:testnet (it accepts ${required.accepts.map((a) => a.network).join(", ")})`);
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
  },
};
