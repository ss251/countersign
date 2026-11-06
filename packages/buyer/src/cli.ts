#!/usr/bin/env bun
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { formatUnits, parseUnits, type Envelope } from "@countersign/core";
import { BuyError, buy } from "./buy.ts";
import { HubClient } from "./hub-client.ts";
import { KNOWN_RAILS } from "./known-rails.ts";
import { Journal } from "./journal.ts";
import { countersignPayer } from "./payer.ts";
import { resume } from "./resume.ts";
import { State } from "./state.ts";

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
}

const BOOLEAN = new Set(["approve", "revoke", "unrevoke"]);

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
  const hub = new HubClient(one("hub") ?? "http://127.0.0.1:8787");
  const state = new State(one("state"));
  const journal = new Journal(state.journalPath);
  const known = [...KNOWN_RAILS, ...state.loadRails()];
  const cmd = pos[0];

  if (cmd === "discover") {
    for (const l of await hub.listOffers()) {
      console.log(
        [l.offerHash.slice(0, 10), l.offer.title, `${formatUnits(BigInt(l.offer.price), 6)} USDC`, l.offer.rails.join(","), l.online ? "online" : "offline"].join("  "),
      );
    }
  } else if (cmd === "buy") {
    const hash = pos[1] as Hex | undefined;
    const raw = one("input");
    if (!hash || raw === undefined) throw new Error("Usage: buy <offerHash> --input '<json>' [--approve]");
    const result = await buy({
      hub,
      offerHash: hash,
      input: JSON.parse(raw),
      payers: [countersignPayer(agentAccount())],
      envelope: state.loadEnvelope(),
      journal,
      state,
      now: Math.floor(Date.now() / 1000),
      approve: flags.has("approve"),
      known,
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
  } else if (cmd === "journal") {
    for (const e of journal.entries()) console.log(JSON.stringify(e));
  } else if (cmd === "resume") {
    const rows = await resume({ hub, journal, state, known });
    if (rows.length === 0) console.log("Nothing to resume.");
    for (const r of rows) console.log(`${r.jobId}  ${r.status}${r.appended ? `  -> ${r.appended}` : ""}`);
  } else {
    console.log("Usage: cli.ts discover | buy <offerHash> --input '<json>' [--approve] | envelope show|set | journal | resume");
    console.log("Flags: --hub <url> --state <dir>. The agent key comes from CS_BUYER_KEY.");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof BuyError || e instanceof Error ? e.message : String(e));
  process.exit(1);
});
