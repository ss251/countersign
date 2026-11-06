/**
 * 21 · Hedera held checkout through the public hub (#157), on demand. Production's Agent Kit seller
 * lists hedera-scheduled first. The agent pays by creating a scheduled USDC transfer to the seller's
 * signing account, and nothing moves until the seller, having delivered, signs it: the hub submits
 * that signature and the schedule executes.
 *
 * 21b · The failure proof, on demand. The same offer with an input the tool cannot serve: the call
 * fails, the seller never signs, the schedule expires unexecuted and the agent releases its hold. The
 * buyer's USDC never moves. A hold lasts the offer's deadline plus 180 s, so this takes about seven
 * minutes.
 *
 * About 0.16 HBAR a purchase, so neither is part of the hourly run: `--flow hedera-held`,
 * `--flow hedera-held-undelivered`. The hourly Agent Kit flow (17) pays the same offer's exact rail.
 */

import { canonicalHash, fromBase64Json, PAYMENT_REQUIRED_HEADER, type Offer, type PaymentRequired, type Slip } from "@countersign/core";
import { verifyCli } from "../lib/actors.ts";
import { agentRun, agentTakes, evidence, hederaExact, hederaHeld, OPEN_CAP, type AgentRun } from "../lib/agent.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, HEDERA } from "../lib/chains.ts";
import { check, equal, NotRun, sameHex, type Flow, type FlowCtx, type RunEnv, type Spend } from "../lib/flow.ts";
import { mirrorGet, mirrorTxId, topicMessage } from "../lib/hedera.ts";
import { sleep } from "../lib/http.ts";
import { MAX_PRICE, MCP_SELLER } from "./hedera-mcp.flow.ts";

const HELD = "hedera-scheduled";
/** cs-hd's failure input: the schema takes it, the Agent Kit tool cannot build a transfer to it. */
const UNDELIVERABLE = { transfers: [{ accountId: "not-an-account", amount: 1 }] };
const ACCOUNT = /^0\.0\.\d+$/;

interface Listing {
  offerHash: string;
  offer: Offer;
  /** The account the held payment credits: the seller's signing account. */
  heldPayTo: string;
  holdSeconds: number;
}

interface MirrorSchedule {
  executed_timestamp?: string | null;
  expiration_time?: string | null;
  payer_account_id?: string;
  creator_account_id?: string;
  wait_for_expiry?: boolean;
  deleted?: boolean;
}

function notRun(env: RunEnv): string | null {
  if (!env.options.publicHub) return "no public hub configured";
  return agentTakes("--prove-undelivered") ? null : "agent-run.ts has no held path yet (#157)";
}

function spends(env: RunEnv): Spend[] {
  const w = wallets(env.secrets);
  return [
    { wallet: w.hdAgentUsdc(), amount: MAX_PRICE, floor: units("0.10", 6) },
    { wallet: w.hdAgentHbar(), amount: units("0.17", 8), floor: units("0.5", 8) }, // measured: ScheduleCreate 0.146 + scheduled transfer 0.013 + HCS
  ];
}

function inputFor(ctx: FlowCtx): unknown {
  const memo = `countersign held e2e ${ctx.env.runId}`;
  return { transfers: [{ accountId: ctx.env.secrets.get("HD_SELLER_ID"), amount: 1 }], transactionMemo: memo };
}

/** Production declares the held rail and the Agent Kit offer lists it first; its 402 offers both payments. */
async function heldListing(ctx: FlowCtx, base: string, input: unknown): Promise<Listing> {
  await ctx.step("production declares the held rail", async () => {
    const res = await ctx.http("rails", `${base}/rails`);
    equal(res.status, 200, "rails status");
    const ids = ((res.json as { rails?: Array<{ id: string }> }).rails ?? []).map((r) => r.id);
    if (!ids.includes(HELD)) throw new NotRun(`production does not declare ${HELD} yet (it declares ${ids.join(", ") || "none"}; HEDERA_SCHEDULED_RAIL, #157)`);
  });

  const found = await ctx.step("the public hub lists the Agent Kit offer with the held rail first", async () => {
    const res = await ctx.http("public offers", `${base}/offers`);
    equal(res.status, 200, "offers status");
    const offers = (res.json as { offers?: { offerHash: string; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
    const mine = offers.filter((x) => x.online && x.status === "listed" && x.offer.adapter === "mcp" && x.offer.seller.toLowerCase() === MCP_SELLER);
    check(mine.length > 0, `the public hub has no online MCP offer from ${MCP_SELLER} (it lists ${offers.length})`);
    const l = mine.find((x) => x.offer.rails[0] === HELD);
    if (!l) throw new NotRun(`the Agent Kit offer does not list ${HELD} first yet (its rails: ${mine.map((x) => x.offer.rails.join("+")).join(", ")})`);
    check(BigInt(l.offer.price) <= MAX_PRICE, `the offer costs ${l.offer.price}, above the suite's 0.05 USDC`);
    sameHex(canonicalHash(l.offer), l.offerHash, "the offer hashes to its offerHash");
    const heldPayTo = l.offer.payTo?.[HELD] ?? "";
    check(ACCOUNT.test(heldPayTo), `the offer's ${HELD} payTo is an account (${heldPayTo})`);
    ctx.note(`held offer ${l.offerHash.slice(0, 10)} (${l.offer.title}): held pays ${heldPayTo}, exact pays ${l.offer.payTo?.hedera}`);
    return { offerHash: l.offerHash, offer: l.offer, heldPayTo };
  });

  const holdSeconds = await ctx.step("the 402 offers the held payment and no plain x402 Hedera", async () => {
    const res = await ctx.http("unpaid call", `${base}/offers/${found.offerHash}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    equal(res.status, 402, `unpaid call status (${res.text.slice(0, 160)})`);
    const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
    check(header, "402 carries PAYMENT-REQUIRED");
    const required = fromBase64Json<PaymentRequired>(header);
    const held = hederaHeld(required);
    check(held, `the 402 offers ${HELD} (it accepts ${required.accepts.map((a) => `${a.network}/${a.scheme}`).join(", ")})`);
    equal(held.payTo, found.heldPayTo, "held payee");
    equal(held.amount, found.offer.price, "held amount");
    equal(held.asset, HEDERA.usdc, "held asset");
    equal(held.maxTimeoutSeconds, found.offer.deadline, "held timeout is the offer's deadline");
    sameHex(String(held.extra?.offerHash ?? ""), found.offerHash, "held offer hash");
    equal(held.extra?.holdSeconds, found.offer.deadline + 180, "hold length");
    check(!hederaExact(required), "the 402 still offers plain x402 Hedera, which production removed by flag (project lead, 23:40 IST)");
    return held.extra?.holdSeconds as number;
  });

  return { ...found, holdSeconds };
}

async function schedule(id: string): Promise<MirrorSchedule> {
  const res = await mirrorGet(`/api/v1/schedules/${id}`);
  equal(res.status, 200, `schedule ${id} read`);
  return res.body as MirrorSchedule;
}

function seconds(ts: string | null | undefined): number {
  return ts ? Number(ts.split(".")[0]) : Number.NaN;
}

function agentOk(run: AgentRun, offerHash: string): void {
  equal(run.code, 0, `agent exit code (stderr ${JSON.stringify(run.stderr.trim().slice(-300))})`);
  equal(run.ok, true, "agent evidence ok");
  sameHex(String(evidence(run.evidence, "offer").value), offerHash, "the agent bought the held offer");
}

function hold(run: AgentRun): { scheduleId: string; createTx: string; logSequence: number } {
  const scheduleId = String(evidence(run.evidence, "schedule").value);
  const createTx = String(evidence(run.evidence, "schedule create").value);
  const log = String(evidence(run.evidence, "hold log").value);
  check(ACCOUNT.test(scheduleId), `schedule id ${scheduleId}`);
  check(/^#\d+$/.test(log), `hold log sequence ${log}`);
  return { scheduleId, createTx, logSequence: Number(log.slice(1)) };
}

/** The agent's expired entry, read from the topic when the evidence does not name it. */
async function findExpired(topicId: string, logSequence: number, scheduleId: string): Promise<number> {
  const until = Date.now() + 180_000;
  for (;;) {
    const res = await mirrorGet(`/api/v1/topics/${topicId}/messages?sequencenumber=gt:${logSequence}&order=asc&limit=50`);
    if (res.status === 200) {
      const messages = (res.body as { messages?: Array<{ sequence_number: number; message: string }> }).messages ?? [];
      for (const m of messages) {
        const text = Buffer.from(m.message, "base64").toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          continue;
        }
        const entry = json as { kind?: string; schedule?: string };
        if (entry?.kind === "expired" && entry.schedule === scheduleId) return m.sequence_number;
      }
    }
    if (Date.now() > until) throw new Error(`no expired entry for ${scheduleId} on the topic after #${logSequence}`);
    await sleep(3000);
  }
}

export const hederaHeldPaid: Flow = {
  name: "hedera-held",
  title: "Hedera held checkout: the seller's signature executes the payment",
  owner: "cs-hd",
  network: "hedera",
  onDemand: "about 0.16 HBAR a run; run it with --flow hedera-held",
  timeoutMs: 6 * 60_000,
  notRun,
  spends,
  async run(ctx) {
    const s = ctx.env.secrets;
    const base = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const agentId = s.get("HD_AGENT_ID");
    const topicId = s.get("HD_TOPIC_ID");
    const input = inputFor(ctx);
    const listing = await heldListing(ctx, base, input);
    const price = BigInt(listing.offer.price);

    const paid = await ctx.step("the agent pays held by default, and the delivered call executes the schedule", async () => {
      const run = await agentRun(ctx, "held", base, OPEN_CAP, { offer: listing.offerHash, input, held: true, timeoutMs: 240_000 });
      ctx.save("agent-evidence.json", run.evidence);
      agentOk(run, listing.offerHash);
      const h = hold(run);
      equal(mirrorTxId(String(evidence(run.evidence, "payment").value)), mirrorTxId(h.createTx), "the payment is the schedule's create");
      const execution = String(evidence(run.evidence, "execution").value);
      check(execution.startsWith("SUCCESS"), `the agent saw the schedule execute (${execution})`);
      const slipHash = String(evidence(run.evidence, "slip").value);
      check(/^0x[0-9a-f]{64}$/i.test(slipHash), `slip hash ${slipHash}`);
      ctx.tx("hedera", "the agent's held payment (schedule create)", h.createTx);
      ctx.note(`schedule ${h.scheduleId}`);
      return { ...h, slipHash };
    });

    await ctx.step("the mirror shows the schedule executed, the agent's and not waiting for expiry", async () => {
      const sch = await schedule(paid.scheduleId);
      check(sch.executed_timestamp, "the schedule has executed");
      equal(sch.creator_account_id, agentId, "schedule creator");
      equal(sch.payer_account_id, agentId, "schedule payer");
      equal(sch.wait_for_expiry, false, "wait_for_expiry");
      equal(sch.deleted, false, "deleted");
    });

    await ctx.step("the scheduled transfer moved exactly the price from the agent to the seller's signing account", async () => {
      const res = await mirrorGet(`/api/v1/transactions/${mirrorTxId(paid.createTx)}?scheduled=true`);
      equal(res.status, 200, "scheduled transaction read");
      const t = ((res.body as { transactions?: Array<{ name?: string; result?: string; token_transfers?: Array<{ token_id: string; account: string; amount: number }> }> }).transactions ?? [])[0];
      check(t, "the mirror has the scheduled transaction");
      equal(t.name, "CRYPTOTRANSFER", "scheduled transaction type");
      equal(t.result, "SUCCESS", "scheduled transaction result");
      const usdc = (t.token_transfers ?? []).filter((x) => x.token_id === HEDERA.usdc);
      equal(usdc.filter((x) => x.account === agentId).reduce((a, x) => a + BigInt(x.amount), 0n), -price, "agent USDC movement");
      const credited = usdc.filter((x) => x.amount > 0);
      equal(credited.length, 1, "accounts credited");
      equal(credited[0]!.account, listing.heldPayTo, "the credited account");
      equal(BigInt(credited[0]!.amount), price, "credit");
    });

    await ctx.step("the HCS log holds the agent's schedule entry", async () => {
      const m = await topicMessage(topicId, paid.logSequence);
      const j = m.json as { kind?: string; schedule?: string; tx?: string; amount?: string; payTo?: string; offerHash?: string };
      equal(j.kind, "schedule", "log entry kind");
      equal(j.schedule, paid.scheduleId, "log entry schedule");
      equal(mirrorTxId(j.tx ?? ""), mirrorTxId(paid.createTx), "log entry names the create transaction");
      equal(j.amount, price.toString(), "log entry amount");
      equal(j.payTo, listing.heldPayTo, "log entry payee");
      sameHex(j.offerHash ?? "", listing.offerHash, "log entry offer");
      equal(m.payerAccount, agentId, "the agent wrote the entry");
    });

    await ctx.step("the slip names the held rail and the schedule's create, and it verifies", async () => {
      const res = await ctx.http("public slip", `${base}/slips/${paid.slipHash}`);
      equal(res.status, 200, "slip status");
      const slip = res.json as Slip;
      const path = ctx.save("slip.json", slip);
      equal(slip.body.rail, HELD, "slip rail");
      sameHex(slip.body.inputHash, canonicalHash(input), "slip.inputHash is the hash of the tool's arguments");
      equal(mirrorTxId(slip.settlement.transaction), mirrorTxId(paid.createTx), "slip settlement");
      // With the mirror, the verifier proves the payment itself: the schedule's create by the buyer,
      // its execution, and the transfer paying the payee exactly the amount (#163).
      const v = await verifyCli(ctx, "held", path, ARC.rpc, { mirror: HEDERA.mirror });
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
      equal(v.checks.get("countersignature"), "ok", "the held payment binds the slip's job");
      equal(v.checks.get("onchain"), "ok", "the mirror proves the held payment");
      check(!v.skipped.some((l) => l.includes("onchain")), `the verifier skipped the mirror check (${v.skipped.join(" | ")})`);
    });
  },
};

export const hederaHeldUndelivered: Flow = {
  name: "hedera-held-undelivered",
  title: "Hedera held checkout: an undelivered call never pays",
  owner: "cs-hd",
  network: "hedera",
  onDemand: "about 0.16 HBAR and 7 minutes a run; run it with --flow hedera-held-undelivered",
  timeoutMs: 15 * 60_000,
  notRun,
  spends,
  async run(ctx) {
    const s = ctx.env.secrets;
    const base = (ctx.env.options.publicHub as string).replace(/\/+$/, "");
    const agentId = s.get("HD_AGENT_ID");
    const topicId = s.get("HD_TOPIC_ID");
    const listing = await heldListing(ctx, base, UNDELIVERABLE);

    const failed = await ctx.step("the call fails, the hold expires unexecuted, and the agent releases it", async () => {
      const run = await agentRun(ctx, "undelivered", base, OPEN_CAP, {
        offer: listing.offerHash,
        input: UNDELIVERABLE,
        proveUndelivered: true,
        timeoutMs: (listing.holdSeconds + 300) * 1000,
      });
      ctx.save("agent-evidence.json", run.evidence);
      agentOk(run, listing.offerHash);
      const h = hold(run);
      const answer = String(evidence(run.evidence, "hub answer").value);
      check(/^HTTP \d+/.test(answer) && !answer.startsWith("HTTP 200"), `the hub did not deliver (${answer})`);
      equal(String(evidence(run.evidence, "executed").value), "none", "the agent saw no execution");
      equal(String(evidence(run.evidence, "release").value), "released", "the agent released the hold");
      const [before, after] = String(evidence(run.evidence, "balance").value).replace(/ USDC$/, "").split(" -> ");
      equal(after, before, "the agent's USDC balance across the hold");
      const expired = run.evidence.find((e) => e.label === "expired log");
      const expiredLog = expired ? String(expired.value) : "";
      // The agent reads the topic before the mirror indexes its own entry, so when the evidence
      // does not name it, the expired entry is found on the topic itself.
      const expiredSequence = /^#\d+$/.test(expiredLog) ? Number(expiredLog.slice(1)) : await findExpired(topicId, h.logSequence, h.scheduleId);
      ctx.tx("hedera", "the agent's hold that never paid (schedule create)", h.createTx);
      ctx.note(`schedule ${h.scheduleId}: ${answer}`);
      return { ...h, expiredSequence };
    });

    await ctx.step("the mirror shows the schedule never executed and has expired", async () => {
      const sch = await schedule(failed.scheduleId);
      check(!sch.executed_timestamp, `the schedule executed at ${sch.executed_timestamp}`);
      equal(sch.creator_account_id, agentId, "schedule creator");
      check(seconds(sch.expiration_time) <= Date.now() / 1000, `the schedule expires at ${sch.expiration_time}, not yet`);
    });

    await ctx.step("no transfer ran from the schedule", async () => {
      const res = await mirrorGet(`/api/v1/transactions/${mirrorTxId(failed.createTx)}?scheduled=true`);
      const txs = res.status === 200 ? ((res.body as { transactions?: unknown[] }).transactions ?? []) : [];
      check(res.status === 404 || (res.status === 200 && txs.length === 0), `the mirror has a scheduled transaction for the hold (status ${res.status}, ${txs.length})`);
    });

    await ctx.step("the HCS log holds the schedule entry and the expired entry, both by the agent", async () => {
      const created = await topicMessage(topicId, failed.logSequence);
      const c = created.json as { kind?: string; schedule?: string; offerHash?: string };
      equal(c.kind, "schedule", "first entry kind");
      equal(c.schedule, failed.scheduleId, "first entry schedule");
      sameHex(c.offerHash ?? "", listing.offerHash, "first entry offer");
      equal(created.payerAccount, agentId, "the agent wrote the schedule entry");
      const released = await topicMessage(topicId, failed.expiredSequence);
      const r = released.json as { kind?: string; schedule?: string; tx?: string };
      equal(r.kind, "expired", "second entry kind");
      equal(r.schedule, failed.scheduleId, "second entry schedule");
      equal(mirrorTxId(r.tx ?? ""), mirrorTxId(failed.createTx), "second entry names the create transaction");
      equal(released.payerAccount, agentId, "the agent wrote the expired entry");
    });
  },
};
