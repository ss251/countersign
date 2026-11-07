/**
 * 17 · Hedera Agent Kit MCP through the public hub (#42). A seller lists Hedera's own Agent Kit
 * MCP server as a metered offer: the runner spawns it in RETURN_BYTES mode, with no operator key,
 * and calls `transfer_hbar_tool`. The Hedera agent pays the call over x402 with no human step.
 * The suite then checks:
 *   - the payment and the HCS entry, read from the mirror node;
 *   - that the slip binds the tool call, through the input hash and the output hash;
 *   - that the bytes the tool returned are an unsigned transfer naming the buyer, decoded here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalHash, fromBase64Json, PAYMENT_REQUIRED_HEADER, type Offer, type PaymentRequired, type Slip } from "@countersign/core";
import { Transaction, TransferTransaction } from "../../packages/rail/src/hedera/sdk.ts";
import { verifyCli } from "../lib/actors.ts";
import { agentRun, evidence, hederaExact, OPEN_CAP, type Evidence } from "../lib/agent.ts";
import { units, wallets } from "../lib/budget.ts";
import { ARC, HEDERA } from "../lib/chains.ts";
import { check, equal, sameHex, type Flow, type FlowCtx } from "../lib/flow.ts";
import { mirrorTransaction, mirrorTxId, netToken, topicMessage } from "../lib/hedera.ts";

/** The seller identity that serves the Agent Kit offer on production (cs-hd, #42). */
export const MCP_SELLER = (process.env.E2E_MCP_SELLER ?? "0xE4eBF122a912BeF5FeC9C56e003FD4Af2CBDB5fE").toLowerCase();
export const MCP_OFFER = (process.env.E2E_MCP_OFFER ?? "0xc0ceb0a067fdb0cfbb169c3ac6b9c4d91b681726f9abe66ad63556b0aeb4443a").toLowerCase();
export const MAX_PRICE = 50_000n;
const PACKAGE = { package: "@hashgraph/hedera-agent-kit-mcp", version: "1.2.0" };
const TOOL = "transfer_hbar_tool";
const HBAR_TO_SEND = 1; // whole HBAR: the offer's schema takes integers only

interface CallRecord {
  tool?: string;
  server?: { name?: string; version?: string };
  package?: { package?: string; version?: string };
  inputHash?: string;
  result?: { bytes?: { data?: number[] } };
}

export const hederaMcp: Flow = {
  name: "hedera-mcp",
  title: "Hedera Agent Kit MCP call paid through the public hub",
  owner: "cs-hd",
  network: "hedera",
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
    const payee = s.get("HD_SELLER_ID");
    const memo = `countersign mcp e2e ${ctx.env.runId}`;
    const input = { transfers: [{ accountId: payee, amount: HBAR_TO_SEND }], transactionMemo: memo };

    const listing = await ctx.step("the public hub lists the Agent Kit MCP offer", async () => {
      const res = await ctx.http("public offers", `${base}/offers`);
      equal(res.status, 200, "offers status");
      const offers = (res.json as { offers?: { offerHash: string; offer: Offer; online: boolean; status: string }[] }).offers ?? [];
      const l = offers.find((x) => x.online && x.status === "listed" && x.offer.adapter === "mcp" && x.offer.seller.toLowerCase() === MCP_SELLER && x.offer.rails.includes("hedera") && x.offerHash.toLowerCase() === MCP_OFFER);
      check(l, `the public hub does not list the pinned Agent Kit offer ${MCP_OFFER.slice(0, 10)} online from ${MCP_SELLER} on Hedera (it lists ${offers.length})`);
      check(BigInt(l.offer.price) <= MAX_PRICE, `the MCP offer costs ${l.offer.price}, above the suite's 0.05 USDC`);
      sameHex(canonicalHash(l.offer), l.offerHash, "the offer hashes to its offerHash");
      ctx.note(`paid MCP offer ${l.offerHash.slice(0, 10)} (${l.offer.title}) to ${l.offer.payTo?.hedera}`);
      return l;
    });
    const price = BigInt(listing.offer.price);
    const sellerAccount = listing.offer.payTo?.hedera as string;

    await ctx.step("402 names the Hedera rail", async () => {
      const res = await ctx.http("unpaid call", `${base}/offers/${listing.offerHash}/call`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      equal(res.status, 402, `unpaid call status (${res.text.slice(0, 160)})`);
      const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
      check(header, "402 carries PAYMENT-REQUIRED");
      // The offer may list the held rail first (#157); its accept pays another account, so this
      // flow, which pays exact, checks the exact accept.
      const e = hederaExact(fromBase64Json<PaymentRequired>(header));
      check(e, "the 402 accepts hedera:testnet, scheme exact");
      equal(e.payTo, sellerAccount, "Hedera payee");
      equal(e.amount, price.toString(), "Hedera amount");
      equal(e.asset, HEDERA.usdc, "Hedera asset");
    });

    const paid = await ctx.step("agent pays, the runner calls the tool", async () => {
      const run = await agentRun(ctx, "mcp", base, OPEN_CAP, { offer: listing.offerHash, input, timeoutMs: 240_000 });
      equal(run.code, 0, `agent exit code (stderr ${JSON.stringify(run.stderr.trim().slice(-300))})`);
      equal(run.ok, true, "agent evidence ok");
      sameHex(String(evidence(run.evidence, "offer").value), listing.offerHash, "the agent bought the MCP offer");
      const tx = String(evidence(run.evidence, "payment").value);
      const log = String(evidence(run.evidence, "spend log").value);
      const slipHash = String(evidence(run.evidence, "slip").value);
      check(/^#\d+$/.test(log), `spend log sequence ${log}`);
      check(/^0x[0-9a-f]{64}$/i.test(slipHash), `slip hash ${slipHash}`);
      ctx.tx("hedera", "agent payment for the MCP call", tx);
      ctx.save("agent-evidence.json", run.evidence);
      return { tx, sequence: Number(log.slice(1)), slipHash };
    });

    await ctx.step("mirror node confirms the payment", async () => {
      const t = await mirrorTransaction(paid.tx);
      equal(t.result, "SUCCESS", "mirror result");
      equal(netToken(t, HEDERA.usdc, agentId), -price, "agent USDC movement");
      equal(netToken(t, HEDERA.usdc, sellerAccount), price, "seller USDC movement");
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

    const record = await ctx.step("the slip binds the MCP call", async () => {
      const res = await ctx.http("public slip", `${base}/slips/${paid.slipHash}`);
      equal(res.status, 200, "slip status");
      const slip = res.json as Slip;
      equal(slip.body.rail, "hedera", "slip rail");
      equal(mirrorTxId(slip.settlement.transaction), mirrorTxId(paid.tx), "slip settlement");
      sameHex(slip.body.inputHash, canonicalHash(input), "slip.inputHash is the hash of the tool's arguments");
      const settlements = await ctx.http("public settlements", `${base}/settlements?limit=50`);
      const rows = (settlements.json as { settlements?: Array<{ slipHash?: string; tx?: string }> }).settlements ?? [];
      check(rows.some((r) => r.slipHash?.toLowerCase() === paid.slipHash.toLowerCase()), "the public hub lists the settlement");
      const path = ctx.save("slip.json", slip);
      const v = await verifyCli(ctx, "mcp", path, ARC.rpc);
      equal(v.verdict, "VALID", `verdict (${v.lines.join(" | ")})`);
      return { slip, path };
    });

    await ctx.step("the payment settled only after delivery (#321)", async () => {
      const t = await mirrorTransaction(paid.tx);
      const consensus = Number(t.consensusTimestamp);
      const delivered = Number(record.slip.body.deliveredAt);
      check(Number.isFinite(consensus) && Number.isFinite(delivered), `consensus ${t.consensusTimestamp}, deliveredAt ${record.slip.body.deliveredAt}`);
      check(consensus > delivered, `the payment reached consensus at ${t.consensusTimestamp}, not after the slip's deliveredAt ${delivered}`);
      ctx.note(`settled after delivery: consensus ${t.consensusTimestamp} > deliveredAt ${delivered}`);
    });

    await ctx.step("the tool's record matches the slip", async () => {
      // The job output is the call record; its canonical hash is the slip's output hash.
      const evidenceFile = JSON.parse(readFileSync(join(ctx.dir, "agent-evidence.json"), "utf8")) as Evidence[];
      const raw = String(evidence(evidenceFile, "output").value);
      let output: CallRecord;
      try {
        output = JSON.parse(raw) as CallRecord;
      } catch {
        throw new Error(`the agent's output evidence is not the full call record (${raw.length} chars); hd-09b prints it whole`);
      }
      ctx.save("call-record.json", output);
      sameHex(record.slip.body.outputHash, canonicalHash(output), "slip.outputHash commits the call record");
      equal(output.tool, TOOL, "tool name");
      equal(output.package?.package, PACKAGE.package, "server package");
      equal(output.package?.version, PACKAGE.version, "server package version");
      check(output.server?.name, "the record names the MCP server");
      sameHex(output.inputHash ?? "", canonicalHash(input), "the record's input hash");
    });

    await ctx.step("the tool returned an unsigned transfer for the buyer", async () => {
      const output = JSON.parse(readFileSync(join(ctx.dir, "call-record.json"), "utf8")) as CallRecord;
      const data = output.result?.bytes?.data;
      check(Array.isArray(data) && data.length > 0, "the record carries the transaction bytes");
      const tx = Transaction.fromBytes(Uint8Array.from(data));
      check(tx instanceof TransferTransaction, `the bytes decode to ${tx.constructor.name}, not a TransferTransaction`);
      equal(tx.transactionId?.accountId?.toString(), agentId, "the transfer's transaction id names the buyer");
      equal(tx.transactionMemo, memo, "the transfer memo is the one sent");
      const legs = new Map<string, bigint>();
      for (const [account, hbar] of tx.hbarTransfers) legs.set(account.toString(), BigInt(hbar.toTinybars().toString()));
      equal(legs.get(payee), BigInt(HBAR_TO_SEND) * 100_000_000n, "the payee's HBAR leg");
      equal(legs.get(agentId), -BigInt(HBAR_TO_SEND) * 100_000_000n, "the buyer's HBAR leg");
      // The map is node -> transaction id -> public key -> signature; an unsigned transfer has
      // an entry per node and transaction id, each with no key in it.
      let signatures = 0;
      for (const [, byTx] of tx.getSignatures()) {
        for (const [, byKey] of byTx as unknown as Iterable<[unknown, Iterable<unknown>]>) for (const _ of byKey) signatures += 1;
      }
      equal(signatures, 0, "signatures on the returned transfer");
    });
  },
};
