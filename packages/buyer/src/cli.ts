#!/usr/bin/env bun
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { formatUnits, parseUnits, RAIL_IDS, type Envelope, type RailId } from "@countersign/core";
import { BuyError, buy } from "./buy.ts";
import { CIRCLE_CATALOGUE, hubCallOf, payableVia, readCatalogue } from "./catalogue.ts";
import { HubClient } from "./hub-client.ts";
import { KNOWN_RAILS } from "./known-rails.ts";
import { Journal } from "./journal.ts";
import { publishEnvelope } from "./mirror.ts";
import { countersignPayer, eip3009Payer, gatewayPayer } from "./payer.ts";
import { resume } from "./resume.ts";
import { acceptJob, disputeJob } from "./review.ts";
import { State } from "./state.ts";

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN = new Set(["approve", "revoke", "unrevoke", "direct"]);

function parse(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      const vals = flags.get(name) ?? [];
      if (BOOLEAN.has(name)) vals.push("true");
      else {
        const v = argv[++i];
        if (v === undefined) throw new Error(`--${name} needs a value.`);
        vals.push(v);
      }
      flags.set(name, vals);
    } else pos.push(a);
  }
  return { pos, flags };
}

function agentAccount() {
  const key = process.env.CS_BUYER_KEY;
  if (!key) throw new Error("Set CS_BUYER_KEY to the agent's private key.");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

const usd = (atomic: string) => formatUnits(BigInt(atomic), 6);

async function main(): Promise<void> {
  const { pos, flags } = parse(process.argv.slice(2));
  const one = (n: string) => flags.get(n)?.[0];
  let hub = new HubClient(one("hub") ?? "http://127.0.0.1:8787");
  const state = new State(one("state"));
  const journal = new Journal(state.journalPath);
  const known = [...KNOWN_RAILS, ...state.loadRails()];
  const cmd = pos[0];

  if (cmd === "discover" && flags.has("catalogue")) {
    const from = one("catalogue") as string;
    const url = from === "circle" ? CIRCLE_CATALOGUE : from;
    const limit = one("limit");
    const page = await readCatalogue(url, {
      ...(pos[1] !== undefined ? { query: pos.slice(1).join(" ") } : {}),
      ...(one("category") !== undefined ? { category: one("category") as string } : {}),
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
    });
    let payable = 0;
    for (const item of page.items) {
      const via = payableVia(item, known);
      if (via) payable++;
      const req = via?.req ?? item.accepts[0];
      console.log(
        [
          via ? via.kind : "-",
          req ? `${formatUnits(BigInt(req.amount), 6)} ${req.network}` : "free",
          item.metadata.provider?.name ?? "?",
          item.resource,
        ].join("  "),
      );
    }
    console.log(`${page.items.length} of ${page.total} listed, ${payable} payable by this agent.`);
  } else if (cmd === "discover") {
    for (const l of await hub.listOffers()) {
      console.log(
        [l.offerHash.slice(0, 10), l.offer.title, `${formatUnits(BigInt(l.offer.price), 6)} USDC`, l.offer.rails.join(","), l.online ? "online" : "offline"].join("  "),
      );
    }
  } else if (cmd === "buy") {
    // A hub call URL from a catalogue names its own hub; the hub's offer is still re-read and hashed.
    const fromUrl = pos[1] !== undefined ? hubCallOf(pos[1]) : undefined;
    if (fromUrl) hub = new HubClient(fromUrl.hub);
    const hash = (fromUrl?.offerHash ?? pos[1]) as Hex | undefined;
    const raw = one("input");
    if (!hash || raw === undefined) throw new Error("Usage: buy <offerHash|callUrl> --input '<json>' [--approve] [--rail <id>] [--approvals hub]");
    const rail = parseRail(one("rail"));
    const approvals = parseApprovals(one("approvals"));
    const account = agentAccount();
    const result = await buy({
      hub,
      offerHash: hash,
      input: JSON.parse(raw),
      payers: [countersignPayer(account), gatewayPayer(account), eip3009Payer(account)],
      envelope: state.loadEnvelope(),
      journal,
      state,
      now: Math.floor(Date.now() / 1000),
      approve: flags.has("approve"),
      known,
      account,
      mirror: flags.has("hub"),
      ...(rail !== undefined ? { rail } : {}),
      ...(approvals !== undefined ? { approvals } : {}),
    });
    console.log(JSON.stringify(result.output, null, 2));
    console.log("Released. Slip minted.");
    console.log(`slip ${result.slip.hash}`);
    console.log(`close tx ${result.slip.settlement.transaction}`);
  } else if (cmd === "envelope" && pos[1] === "show") {
    console.log(JSON.stringify(state.loadEnvelope(), null, 2));
  } else if (cmd === "envelope" && pos[1] === "set") {
    let env: Envelope;
    try {
      env = state.loadEnvelope();
    } catch {
      env = { v: 1, agent: agentAccount().address, cap: "0", perMerchant: "0", allowlist: [], revoked: false };
    }
    env.agent = agentAccount().address;
    const cap = one("cap");
    if (cap !== undefined) env.cap = parseUnits(cap, 6).toString(10);
    const pm = one("per-merchant");
    if (pm !== undefined) env.perMerchant = parseUnits(pm, 6).toString(10);
    const ask = one("ask-above");
    if (ask !== undefined) env.askAbove = parseUnits(ask, 6).toString(10);
    const allow = flags.get("allow");
    if (allow) env.allowlist = [...new Set([...env.allowlist, ...allow.map((x) => x.toLowerCase())])];
    if (flags.has("revoke")) env.revoked = true;
    if (flags.has("unrevoke")) env.revoked = false;
    state.saveEnvelope(env);
    console.log(`Envelope saved. Budget ${usd(env.cap)} USDC, ${usd(env.perMerchant)} per seller${env.revoked ? ", revoked" : ""}.`);
  } else if ((cmd === "accept" || cmd === "dispute") && pos[1] !== undefined) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(pos[1])) throw new Error(`Usage: ${cmd} <jobId>`);
    const account = agentAccount();
    const args = { hub, journal, state, known, signer: account, jobId: pos[1] as Hex, now: Math.floor(Date.now() / 1000) };
    if (cmd === "accept") {
      const done = await acceptJob(args);
      console.log(`Accepted ${done.jobId}. The hub relays it; the seller is paid when it lands.`);
    } else {
      const done = await disputeJob({
        ...args,
        ...(flags.has("direct") ? { direct: true, account } : {}),
      });
      console.log(
        done.transaction
          ? `Disputed ${done.jobId}. The hub did not relay it; sent ${done.transaction}.`
          : `Disputed ${done.jobId}. The hub relays it; run resume to see the refund land.`,
      );
    }
  } else if (cmd === "journal") {
    for (const e of journal.entries()) console.log(JSON.stringify(e));
  } else if (cmd === "publish-envelope") {
    const account = agentAccount();
    const ok = await publishEnvelope({
      hub,
      account,
      envelope: state.loadEnvelope(),
      spent: journal.spend(),
      now: Math.floor(Date.now() / 1000),
    });
    console.log(ok ? "Envelope published." : "Envelope publish failed.");
  } else if (cmd === "resume") {
    const mirror = flags.has("hub")
      ? { account: agentAccount(), envelope: state.loadEnvelope() }
      : undefined;
    const rows = await resume({
      hub,
      journal,
      state,
      known,
      ...(mirror !== undefined ? { mirror } : {}),
    });
    if (rows.length === 0) console.log("Nothing to resume.");
    for (const r of rows) console.log(`${r.jobId}  ${r.status}${r.appended ? `  -> ${r.appended}` : ""}`);
  } else {
    console.log("Usage: cli.ts discover [--catalogue <url|circle> [query] [--category <c>] [--limit <n>]] | buy <offerHash|callUrl> --input '<json>' [--approve] [--rail <id>] [--approvals hub] | accept <jobId> | dispute <jobId> [--direct] | envelope show|set | publish-envelope | journal | resume");
    console.log("Flags: --hub <url> --state <dir>. The agent key comes from CS_BUYER_KEY.");
  }
}

function parseApprovals(raw: string | undefined): "local" | "hub" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "local" || raw === "hub") return raw;
  throw new Error(`Unknown approvals mode ${raw}.`);
}

function parseRail(raw: string | undefined): RailId | undefined {
  if (raw === undefined) return undefined;
  if (!RAIL_IDS.includes(raw as RailId)) throw new Error(`Unknown rail ${raw}.`);
  return raw as RailId;
}

main().catch((e: unknown) => {
  console.error(e instanceof BuyError || e instanceof Error ? e.message : String(e));
  process.exit(1);
});
