/**
 * 20 · Hedera scheduled checkout (#41), on demand. The agent creates a scheduled USDC payment to a
 * seller account that requires its own signature, and logs it on HCS as a `schedule` entry.
 * Nothing moves until the seller, having checked the scheduled body strictly, signs; the transfer
 * then executes. The suite runs cs-hd's script and then reads the mirror node itself.
 *
 * About 0.18 HBAR a run, so it is not part of the hourly run: `--flow hedera-schedule`.
 */

import { join } from "node:path";
import { units, wallets } from "../lib/budget.ts";
import { HEDERA } from "../lib/chains.ts";
import { check, equal, type Flow } from "../lib/flow.ts";
import { mirrorGet, mirrorTxId, topicMessage } from "../lib/hedera.ts";
import { runCmd } from "../lib/procs.ts";

const PRICE = 10_000n; // 0.01 USDC

interface ScheduleEvidence {
  beat?: string;
  mode?: string;
  ok?: boolean;
  evidence?: {
    agent?: { id?: string; url?: string };
    offer?: { title?: string; hash?: string; price?: string };
    create?: { tx?: string; url?: string };
    schedule?: { id?: string; url?: string; expiresAt?: string | number };
    sign?: { tx?: string; url?: string };
    executed?: { consensusTimestamp?: string; credit?: string };
    log?: Array<{ sequence?: number; kind?: string; url?: string }>;
    audit?: { matched?: number; unbacked?: number; unlogged?: number; pending?: number; released?: number };
  };
}

export const hederaSchedule: Flow = {
  name: "hedera-schedule",
  title: "Hedera scheduled checkout: the seller's signature executes it",
  owner: "cs-hd",
  network: "hedera",
  // Parked by the firstmate (captain, 19:40 IST) until the hourly suite is green again; it also costs HBAR.
  onDemand: "parked until the suite is green, about 0.18 HBAR a run; run it with --flow hedera-schedule",
  spends(env) {
    const w = wallets(env.secrets);
    return [
      { wallet: w.hdAgentUsdc(), amount: PRICE, floor: units("1.00", 6) },
      { wallet: w.hdAgentHbar(), amount: units("0.2", 8), floor: units("0.5", 8) },
    ];
  },
  async run(ctx) {
    const s = ctx.env.secrets;
    const agentId = s.get("HD_AGENT_ID");
    const topicId = s.get("HD_TOPIC_ID");

    const ev = await ctx.step("the agent schedules a payment and the seller's signature executes it", async () => {
      const r = await runCmd(
        {
          name: "schedule",
          // The script reads its own keys from the Hedera env file; nothing is passed to it here.
          cmd: ["bun", "scripts/hedera/schedule.ts", "--json"],
          log: join(ctx.dir, "schedule.log"),
          redact: (t) => s.redact(t),
        },
        300_000,
      );
      const last = r.stdout.trim().split("\n").at(-1) ?? "";
      let parsed: ScheduleEvidence;
      try {
        parsed = JSON.parse(last) as ScheduleEvidence;
      } catch {
        throw new Error(`schedule.ts printed no JSON (exit ${r.code}; stderr ${JSON.stringify(r.stderr.trim().slice(-300))})`);
      }
      ctx.save("schedule-evidence.json", parsed);
      equal(r.code, 0, `schedule.ts exit code (2 means its funds gate stopped it)`);
      equal(parsed.beat, "hedera-schedule", "evidence beat");
      equal(parsed.mode, "main", "evidence mode");
      equal(parsed.ok, true, "evidence ok");
      const e = parsed.evidence;
      check(e?.schedule?.id && e.create?.tx && e.sign?.tx, "the evidence names the schedule, its create and the seller's sign");
      equal(e.agent?.id, agentId, "the agent that scheduled");
      ctx.tx("hedera", "schedule create", e.create.tx);
      ctx.tx("hedera", "seller signs, transfer executes", e.sign.tx);
      ctx.note(`schedule ${e.schedule.id}`);
      return e;
    });

    await ctx.step("the mirror shows the schedule executed, paid by the agent, not waiting for expiry", async () => {
      const res = await mirrorGet(`/api/v1/schedules/${ev.schedule?.id}`);
      equal(res.status, 200, "schedule read");
      const sch = res.body as { executed_timestamp?: string | null; payer_account_id?: string; wait_for_expiry?: boolean; deleted?: boolean };
      check(sch.executed_timestamp, "the schedule has executed");
      equal(sch.payer_account_id, agentId, "schedule payer");
      equal(sch.wait_for_expiry, false, "wait_for_expiry");
    });

    await ctx.step("the scheduled transfer moved exactly the price from the agent", async () => {
      const res = await mirrorGet(`/api/v1/transactions/${mirrorTxId(ev.create?.tx as string)}?scheduled=true`);
      equal(res.status, 200, "scheduled transaction read");
      const t = ((res.body as { transactions?: Array<{ name?: string; result?: string; token_transfers?: Array<{ token_id: string; account: string; amount: number }> }> }).transactions ?? [])[0];
      check(t, "the mirror has the scheduled transaction");
      equal(t.name, "CRYPTOTRANSFER", "scheduled transaction type");
      equal(t.result, "SUCCESS", "scheduled transaction result");
      const usdc = (t.token_transfers ?? []).filter((x) => x.token_id === HEDERA.usdc);
      equal(usdc.filter((x) => x.account === agentId).reduce((a, x) => a + BigInt(x.amount), 0n), -PRICE, "agent USDC movement");
      const credited = usdc.filter((x) => x.amount > 0);
      equal(credited.length, 1, "accounts credited");
      equal(BigInt(credited[0]!.amount), PRICE, "credit");
      ctx.note(`credited ${credited[0]!.account}`);
    });

    await ctx.step("the HCS log names the schedule, and the script's audit is clean", async () => {
      const entry = (ev.log ?? []).find((l) => l.kind === "schedule");
      check(entry?.sequence !== undefined, "the evidence names a schedule entry on the log");
      const m = await topicMessage(topicId, entry.sequence as number);
      const j = m.json as { kind?: string; schedule?: string; tx?: string; amount?: string };
      equal(j.kind, "schedule", "log entry kind");
      equal(j.schedule, ev.schedule?.id, "log entry schedule");
      equal(mirrorTxId(j.tx ?? ""), mirrorTxId(ev.create?.tx as string), "log entry names the create transaction");
      equal(j.amount, PRICE.toString(), "log entry amount");
      equal(m.payerAccount, agentId, "the agent wrote the entry");
      equal(ev.audit?.matched, 1, "audit matched");
      equal(ev.audit?.unbacked, 0, "audit unbacked");
      equal(ev.audit?.unlogged, 0, "audit unlogged");
    });
  },
};
